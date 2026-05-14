import type Homey from "homey";
import net from "net";
import http from "http";
import { OmnikLocalApi, OmnikProtocol, InverterData } from "./api";
import { OmnikHttpApi } from "./http-api";

// Settings keys whose value must never appear in a diagnostic report.
const SECRET_SETTINGS_KEYS = new Set<string>(["http_password"]);

export interface ProbeResult {
  label: string;
  target: string;
  status: "ok" | "fail" | "skipped";
  durationMs?: number;
  statusCode?: number;
  errorName?: string;
  errorMessage?: string;
  responseSummary?: string;
  responseRaw?: unknown;
}

export interface StatusJsSnapshot {
  source: "no-auth" | "configured-auth" | "admin-admin-fallback";
  statusCode: number;
  contentType?: string;
  bodyLength: number;
  bodyPreview: string;
  m2mMid?: string;
  wlanMac?: string;
  wifiFirmware?: string;
  webDataSource: "webData" | "myDeviceArray[0]" | "none";
  deviceFields?: string[];
  parseResult: "ok" | "parse-error" | "not-attempted";
  parseError?: string;
  parsed?: Pick<InverterData, "currentPower" | "dailyProduction" | "totalProduction">;
}

export interface DeviceSnapshot {
  id: string;
  name: string;
  available: boolean;
  settings: Record<string, unknown>;
  store: Record<string, unknown>;
  capabilities: Array<{ id: string; value: unknown }>;
}

export interface NetworkSnapshot {
  ip: string;
  arpMac?: string;
  arpError?: string;
  tcpReachable?: boolean;
  tcpError?: string;
}

export interface DiagnosticReport {
  generatedAt: string;
  appVersion: string;
  homeyFirmwareVersion?: string;
  homeyPlatform?: string;
  scope: "paired-device" | "ip-only";
  scopeTarget: string;
  device?: DeviceSnapshot;
  network?: NetworkSnapshot;
  statusJs: StatusJsSnapshot[];
  probes: ProbeResult[];
}

const RESPONSE_PREVIEW_LENGTH = 1200;
const RAW_BODY_PREVIEW_LENGTH = 3000;
const PER_PROBE_TIMEOUT_MS = 6_000;
const TCP_REACHABILITY_TIMEOUT_MS = 3_000;

interface ProbeRunner {
  (): Promise<unknown>;
}

export type ProgressCallback = (message: string) => void;

export async function generateDeviceReport(opts: {
  device: Homey.Device;
  appVersion: string;
  homeyFirmwareVersion?: string;
  homeyPlatform?: string;
  network?: NetworkSnapshot;
  onProgress?: ProgressCallback;
}): Promise<DiagnosticReport> {
  const { device, appVersion, homeyFirmwareVersion, homeyPlatform, network, onProgress } = opts;
  const settings = device.getSettings() as Record<string, unknown>;
  const ip = String(settings.ip ?? "");
  const wifiSn = settings.wifi_sn ? Number(settings.wifi_sn) : Number((device.getData() as { id?: number }).id);
  const auth = settings.http_user
    ? { user: String(settings.http_user), password: String(settings.http_password ?? "") }
    : undefined;

  const { probes, statusJs } = await runAllProbes({
    ip,
    wifiSn: Number.isFinite(wifiSn) ? wifiSn : undefined,
    auth,
    onProgress,
  });

  return {
    generatedAt: new Date().toISOString(),
    appVersion,
    homeyFirmwareVersion,
    homeyPlatform,
    scope: "paired-device",
    scopeTarget: device.getName(),
    device: snapshotDevice(device),
    network,
    statusJs,
    probes,
  };
}

/**
 * Build a report against an IP address only, used when the inverter refuses to
 * pair. Without a known WiFi-stick S/N up-front we can still extract it from
 * the raw /js/status.js capture and feed it into the binary TCP probe.
 */
export async function generateIpReport(opts: {
  ip: string;
  appVersion: string;
  homeyFirmwareVersion?: string;
  homeyPlatform?: string;
  network?: NetworkSnapshot;
  onProgress?: ProgressCallback;
}): Promise<DiagnosticReport> {
  const { ip, appVersion, homeyFirmwareVersion, homeyPlatform, network, onProgress } = opts;

  const { probes, statusJs } = await runAllProbes({ ip, onProgress });

  return {
    generatedAt: new Date().toISOString(),
    appVersion,
    homeyFirmwareVersion,
    homeyPlatform,
    scope: "ip-only",
    scopeTarget: ip,
    network,
    statusJs,
    probes,
  };
}

function snapshotDevice(device: Homey.Device): DeviceSnapshot {
  const data = device.getData() as { id?: number | string };
  const rawSettings = device.getSettings() as Record<string, unknown>;
  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawSettings)) {
    if (SECRET_SETTINGS_KEYS.has(key)) {
      settings[key] = value ? "<redacted>" : "";
      continue;
    }
    settings[key] = value;
  }

  const store: Record<string, unknown> = {};
  for (const key of device.getStoreKeys() ?? []) {
    store[key] = device.getStoreValue(key);
  }

  const capabilities = device.getCapabilities().map((cap) => ({
    id: cap,
    value: device.getCapabilityValue(cap),
  }));

  return {
    id: String(data.id ?? device.getName()),
    name: device.getName(),
    available: device.getAvailable(),
    settings,
    store,
    capabilities,
  };
}

async function runAllProbes(opts: {
  ip: string;
  wifiSn?: number;
  auth?: { user: string; password: string };
  onProgress?: ProgressCallback;
}): Promise<{ probes: ProbeResult[]; statusJs: StatusJsSnapshot[] }> {
  const { ip, auth, onProgress } = opts;
  let { wifiSn } = opts;
  const progress = (msg: string) => onProgress?.(msg);

  progress(`Checking TCP/8899 reachability and capturing /js/status.js on ${ip}…`);

  // Phase 1: TCP reachability + raw /js/status.js capture. The raw capture
  // always returns the response body (even when the typed parser would
  // explode on an unknown variable name), so we can both diagnose unknown
  // firmware quirks and recover the WiFi-stick S/N from `m2mMid` as a
  // fallback wifiSn for the TCP binary probe below.
  const phase1Tasks: Array<Promise<ProbeResult>> = [
    runProbe(
      "TCP/8899 port reachability",
      `tcp://${ip}:8899`,
      async () => {
        const r = await probeTcpReachable(ip, 8899, TCP_REACHABILITY_TIMEOUT_MS);
        return { open: r.open, errorCode: r.errorCode };
      },
    ),
    runProbe(
      "HTTP /js/status.js raw capture (no auth)",
      `http://${ip}:80/js/status.js`,
      () => probeRawStatusJs(ip, undefined, "no-auth"),
    ),
  ];
  if (auth) {
    phase1Tasks.push(
      runProbe(
        "HTTP /js/status.js raw capture (configured auth)",
        `http://${ip}:80/js/status.js`,
        () => probeRawStatusJs(ip, auth, "configured-auth"),
      ),
    );
  } else {
    phase1Tasks.push(
      runProbe(
        "HTTP /js/status.js raw capture (admin/admin)",
        `http://${ip}:80/js/status.js`,
        () => probeRawStatusJs(ip, { user: "admin", password: "admin" }, "admin-admin-fallback"),
      ),
    );
  }
  const phase1 = await Promise.all(phase1Tasks);

  const statusJs: StatusJsSnapshot[] = phase1
    .map((p) => p.responseRaw)
    .filter((r): r is StatusJsSnapshot => isStatusJsSnapshot(r));

  if (!wifiSn) {
    const discoveredMid = statusJs
      .map((s) => s.m2mMid)
      .find((v) => v && /^\d+$/.test(v));
    if (discoveredMid) wifiSn = Number(discoveredMid);
  }

  // Phase 2: TCP binary protocol (only meaningful with a known S/N).
  const phase2Tasks: Array<Promise<ProbeResult>> = [];
  if (wifiSn && wifiSn > 0) {
    progress(`Probing TCP binary protocol with S/N ${wifiSn}…`);
    const sn = wifiSn;
    phase2Tasks.push(
      runProbe(
        `TCP binary protocol (S/N ${sn})`,
        `tcp://${ip}:8899 (0x68 frame)`,
        async () => {
          const api = new OmnikLocalApi({ address: ip, wifiSn: sn, timeoutMs: PER_PROBE_TIMEOUT_MS });
          return await api.getData();
        },
      ),
      runProbe(
        `TCP raw frame capture (S/N ${sn})`,
        `tcp://${ip}:8899 (raw bytes)`,
        () => captureRawTcpFrame(ip, sn, PER_PROBE_TIMEOUT_MS),
      ),
    );
  } else {
    progress("Skipping TCP binary probe — no WiFi-stick S/N available.");
    phase2Tasks.push(
      runProbe(
        "TCP binary protocol",
        `tcp://${ip}:8899`,
        async () => {
          throw new Error(
            "No WiFi-stick S/N known — neither pairing settings nor /js/status.js gave one (m2mMid missing or unreadable).",
          );
        },
      ),
    );
  }
  const phase2 = await Promise.all(phase2Tasks);
  progress("All probes done, rendering report…");

  return { probes: [...phase1, ...phase2], statusJs };
}

function isStatusJsSnapshot(value: unknown): value is StatusJsSnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    "webDataSource" in value &&
    "bodyLength" in value &&
    "source" in value
  );
}

async function probeRawStatusJs(
  ip: string,
  auth: { user: string; password: string } | undefined,
  source: StatusJsSnapshot["source"],
): Promise<StatusJsSnapshot> {
  const res = await rawHttpGet(ip, "/js/status.js", auth, PER_PROBE_TIMEOUT_MS);

  const matchVar = (name: string): string | undefined => {
    const m = res.body.match(new RegExp(`var\\s+${name}\\s*=\\s*"([^"]*)"`));
    return m?.[1];
  };
  const webDataMatch = res.body.match(/webData\s*=\s*"([^"]*)"/);
  const arrayMatch = res.body.match(/myDeviceArray\s*\[\s*0\s*\]\s*=\s*"([^"]*)"/);
  const rawFields = webDataMatch?.[1] ?? arrayMatch?.[1];
  const webDataSource: StatusJsSnapshot["webDataSource"] = webDataMatch
    ? "webData"
    : arrayMatch
      ? "myDeviceArray[0]"
      : "none";
  const deviceFields = rawFields?.split(",").map((f) => f.trim());

  const snapshot: StatusJsSnapshot = {
    source,
    statusCode: res.statusCode,
    contentType: res.contentType || undefined,
    bodyLength: res.body.length,
    bodyPreview:
      res.body.length > RAW_BODY_PREVIEW_LENGTH
        ? `${res.body.slice(0, RAW_BODY_PREVIEW_LENGTH)}… (truncated, ${res.body.length} chars total)`
        : res.body,
    m2mMid: matchVar("m2mMid"),
    wlanMac: matchVar("wlanMac"),
    wifiFirmware: matchVar("version"),
    webDataSource,
    deviceFields,
    parseResult: "not-attempted",
  };

  if (deviceFields && deviceFields.length >= 8) {
    try {
      const parsed = OmnikHttpApi.parseInverterData(deviceFields);
      snapshot.parseResult = "ok";
      snapshot.parsed = {
        currentPower: parsed.currentPower,
        dailyProduction: parsed.dailyProduction,
        totalProduction: parsed.totalProduction,
      };
    } catch (err) {
      snapshot.parseResult = "parse-error";
      snapshot.parseError = (err as Error).message;
    }
  }

  // A non-2xx response is still useful for diagnostics — we want to see the
  // body even on 401. Don't throw; the snapshot records `statusCode` so the
  // renderer can flag it.
  return snapshot;
}

function rawHttpGet(
  ip: string,
  path: string,
  auth: { user: string; password: string } | undefined,
  timeoutMs: number,
): Promise<{ statusCode: number; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (auth) {
      const token = Buffer.from(`${auth.user}:${auth.password}`).toString("base64");
      headers["Authorization"] = `Basic ${token}`;
    }
    const req = http.get(
      { host: ip, port: 80, path, headers, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            contentType: typeof res.headers["content-type"] === "string" ? res.headers["content-type"] : "",
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`HTTP request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
  });
}

async function probeTcpReachable(
  ip: string,
  port: number,
  timeoutMs: number,
): Promise<{ open: boolean; errorCode?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (result: { open: boolean; errorCode?: string }) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ open: true }));
    socket.once("timeout", () => finish({ open: false, errorCode: "ETIMEDOUT" }));
    socket.once("error", (err: NodeJS.ErrnoException) => finish({ open: false, errorCode: err.code ?? err.message }));
    socket.connect(port, ip);
  });
}

async function captureRawTcpFrame(
  ip: string,
  wifiSn: number,
  timeoutMs: number,
): Promise<{ bytesReceived: number; hexPreview: string; parsable: boolean; parseError?: string; parsed?: InverterData }> {
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };
    socket.setTimeout(timeoutMs);
    socket.on("data", (chunk: Buffer) => settle(() => resolve(chunk)));
    socket.on("timeout", () => settle(() => reject(new Error("TCP read timed out"))));
    socket.on("error", (err) => settle(() => reject(err)));
    socket.on("ready", () => {
      try {
        socket.write(OmnikProtocol.buildRequest(wifiSn));
      } catch (err) {
        settle(() => reject(err));
      }
    });
    socket.connect(8899, ip);
  });

  const hex = buffer.toString("hex");
  const preview = hex.length > 200 ? `${hex.slice(0, 200)}…` : hex;
  try {
    const parsed = OmnikProtocol.parseResponse(buffer);
    return { bytesReceived: buffer.length, hexPreview: preview, parsable: true, parsed };
  } catch (err) {
    return {
      bytesReceived: buffer.length,
      hexPreview: preview,
      parsable: false,
      parseError: (err as Error).message,
    };
  }
}

async function runProbe(label: string, target: string, runner: ProbeRunner): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const result = await withTimeout(runner(), PER_PROBE_TIMEOUT_MS + 500);
    return {
      label,
      target,
      status: "ok",
      durationMs: Date.now() - started,
      responseSummary: summariseResponse(result),
      responseRaw: result,
    };
  } catch (err) {
    const e = err as Error & { statusCode?: number; code?: string };
    return {
      label,
      target,
      status: "fail",
      durationMs: Date.now() - started,
      statusCode: e.statusCode,
      errorName: e.name,
      errorMessage: e.code ? `${e.code}: ${e.message}` : e.message,
    };
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Probe timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function summariseResponse(value: unknown): string {
  if (value == null) return String(value);
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return "<unserialisable>";
  }
  if (json.length <= RESPONSE_PREVIEW_LENGTH) return json;
  return `${json.slice(0, RESPONSE_PREVIEW_LENGTH)}… (truncated, ${json.length} chars)`;
}

export function renderMarkdown(report: DiagnosticReport): string {
  const lines: string[] = [];
  const scopeHeader = report.scope === "paired-device"
    ? `paired device "${report.scopeTarget}"`
    : `IP address \`${report.scopeTarget}\` (no paired device)`;
  lines.push("# Omnik diagnostic report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- App version: ${report.appVersion}`);
  if (report.homeyFirmwareVersion) lines.push(`- Homey firmware: ${report.homeyFirmwareVersion}`);
  if (report.homeyPlatform) lines.push(`- Homey platform: ${report.homeyPlatform}`);
  lines.push(`- Scope: ${scopeHeader}`);
  lines.push("");

  if (report.device) {
    const device = report.device;
    lines.push("## Device snapshot");
    lines.push("");
    lines.push(`- Name: ${device.name}`);
    lines.push(`- Data id (WiFi-stick S/N): ${device.id}`);
    lines.push(`- Available: ${device.available ? "yes" : "no"}`);
    lines.push("");
    lines.push("### Settings");
    lines.push("```json");
    lines.push(JSON.stringify(device.settings, null, 2));
    lines.push("```");
    lines.push("");
    if (Object.keys(device.store).length > 0) {
      lines.push("### Store");
      lines.push("```json");
      lines.push(JSON.stringify(device.store, null, 2));
      lines.push("```");
      lines.push("");
    }
    const stateful = device.capabilities.filter((c) => c.value !== null && c.value !== undefined);
    const stateless = device.capabilities.filter((c) => c.value === null || c.value === undefined);
    lines.push(`### Capabilities (${device.capabilities.length} total, ${stateful.length} with state)`);
    for (const cap of stateful) {
      lines.push(`- \`${cap.id}\` = ${JSON.stringify(cap.value)}`);
    }
    if (stateless.length > 0) {
      lines.push("");
      lines.push(`<details><summary>${stateless.length} stateless capabilities</summary>`);
      lines.push("");
      lines.push(stateless.map((c) => `\`${c.id}\``).join(", "));
      lines.push("");
      lines.push("</details>");
    }
    lines.push("");
  }

  if (report.network) {
    lines.push("## Network");
    lines.push("");
    lines.push(`- Configured IP: \`${report.network.ip}\``);
    if (report.network.arpMac) {
      lines.push(`- ARP-resolved MAC: \`${report.network.arpMac}\``);
    } else if (report.network.arpError) {
      lines.push(`- ARP lookup failed: ${report.network.arpError}`);
    } else {
      lines.push(`- ARP lookup: no MAC found (inverter may be powered off or on a different subnet)`);
    }
    lines.push("");
  }

  if (report.statusJs.length > 0) {
    lines.push("## /js/status.js inspection");
    lines.push("");
    lines.push(
      "Raw HTTP capture of the inverter's status page. This is the primary data point for diagnosing unknown firmware variants — see the body preview below if parsing failed.",
    );
    lines.push("");
    for (const s of report.statusJs) {
      const httpOk = s.statusCode >= 200 && s.statusCode < 300;
      const httpIcon = httpOk ? "✅" : "❌";
      lines.push(`### ${authLabel(s.source)} — ${httpIcon} HTTP ${s.statusCode}`);
      lines.push("");
      lines.push(`- m2mMid (WiFi-stick S/N): ${s.m2mMid ? `\`${s.m2mMid}\`` : "*(not extracted)*"}`);
      lines.push(`- WLAN MAC: ${s.wlanMac ? `\`${s.wlanMac}\`` : "*(not extracted)*"}`);
      lines.push(`- WiFi-module firmware: ${s.wifiFirmware ? `\`${s.wifiFirmware}\`` : "*(not extracted)*"}`);
      lines.push(`- Device-fields source: \`${s.webDataSource}\``);
      if (s.deviceFields) {
        lines.push(`- Device fields (${s.deviceFields.length}):`);
        s.deviceFields.forEach((f, i) => lines.push(`  - [${i}] \`${f}\``));
      }
      lines.push(`- Parse result: ${parseResultLabel(s)}`);
      if (s.parsed) {
        lines.push(
          `  - currentPower=${s.parsed.currentPower}W, daily=${s.parsed.dailyProduction}kWh, total=${s.parsed.totalProduction}kWh`,
        );
      }
      lines.push("");
      lines.push(`<details><summary>Body preview (${s.bodyLength} chars)</summary>`);
      lines.push("");
      lines.push("```");
      lines.push(s.bodyPreview);
      lines.push("```");
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  lines.push("## Probes");
  lines.push("");
  lines.push("| Result | Probe | Target | Status | Time | Summary |");
  lines.push("|---|---|---|---|---|---|");
  for (const p of report.probes) {
    const result = p.status === "ok" ? "✅" : p.status === "skipped" ? "⏭" : "❌";
    const status = p.status === "ok" ? "ok" : `${p.statusCode ?? ""} ${p.errorName ?? ""}`.trim() || "fail";
    const time = p.durationMs != null ? `${p.durationMs} ms` : "-";
    const summary = p.status === "ok"
      ? truncateForTable(probeTableSummary(p))
      : truncateForTable(p.errorMessage ?? "");
    lines.push(`| ${result} | ${p.label} | \`${p.target}\` | ${status} | ${time} | ${summary} |`);
  }
  lines.push("");

  lines.push("## Raw probe data (JSON)");
  lines.push("");
  lines.push("<details><summary>Click to expand</summary>");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(report.probes.map(stripRaw), null, 2));
  lines.push("```");
  lines.push("");
  lines.push("</details>");

  return lines.join("\n");
}

function authLabel(source: StatusJsSnapshot["source"]): string {
  switch (source) {
    case "no-auth":
      return "no auth";
    case "configured-auth":
      return "configured auth";
    case "admin-admin-fallback":
      return "admin/admin fallback";
  }
}

function parseResultLabel(s: StatusJsSnapshot): string {
  if (s.parseResult === "ok") return "✅ parsed cleanly";
  if (s.parseResult === "parse-error") return `❌ ${s.parseError ?? "parse failed"}`;
  return "⏭ not attempted (device fields not extracted)";
}

/**
 * For raw /js/status.js probes the responseSummary contains the full body
 * preview, which crowds out the table cell. Use the snapshot's HTTP status +
 * extracted m2mMid as a much shorter at-a-glance summary instead.
 */
function probeTableSummary(p: ProbeResult): string {
  if (isStatusJsSnapshot(p.responseRaw)) {
    const s = p.responseRaw;
    const sn = s.m2mMid ? `m2mMid=${s.m2mMid}` : "no m2mMid";
    return `HTTP ${s.statusCode}, ${sn}, fields-via ${s.webDataSource}`;
  }
  return p.responseSummary ?? "";
}

function truncateForTable(text: string): string {
  const cleaned = text.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}…` : cleaned;
}

function stripRaw(p: ProbeResult): ProbeResult {
  const { responseRaw: _, ...rest } = p;
  return rest;
}
