import { randomUUID } from "node:crypto";
import type Homey from "homey/lib/Homey";
import type HomeyDevice from "homey/lib/Device";
import {
  type DiagnosticReport,
  type NetworkSnapshot,
  type ProgressCallback,
  generateDeviceReport,
  generateIpReport,
  renderMarkdown,
} from "./lib/diagnostic";

const DRIVER_ID = "omnik-local";
const ARP_TIMEOUT_MS = 5000;

// One event name per kind, filtered by runId on the settings page, so the page can subscribe
// once at load and never misses events between starting a run and subscribing.
const EVENT_PROGRESS = "omnik:report:progress";
const EVENT_COMPLETE = "omnik:report:complete";
const EVENT_ERROR = "omnik:report:error";

interface ApiArgs {
  homey: Homey;
}

interface ReportArgs extends ApiArgs {
  body: { deviceId?: unknown };
}

interface ProbeIpArgs extends ApiArgs {
  body: { ip?: unknown };
}

function deviceId(device: HomeyDevice): string {
  const data = device.getData() as { id?: string | number };
  return String(data.id ?? device.getName());
}

module.exports = {
  async listDevices({ homey }: ApiArgs): Promise<Array<{ id: string; name: string }>> {
    const driver = homey.drivers.getDriver(DRIVER_ID);
    return driver.getDevices().map((d) => ({ id: deviceId(d), name: d.getName() }));
  },

  /**
   * Returns a runId at once and delivers the report through realtime events, because Homey
   * aborts long API requests and probing an unreachable inverter takes a while.
   */
  async generateReport({ homey, body }: ReportArgs): Promise<{ runId: string }> {
    const wanted = typeof body?.deviceId === "string" ? body.deviceId : "";
    const device = homey.drivers
      .getDriver(DRIVER_ID)
      .getDevices()
      .find((d) => deviceId(d) === wanted);
    if (!device) {
      throw new Error(homey.__("settings.error.device_not_found", { id: wanted }));
    }

    const runId = randomUUID();
    runInBackground(homey, runId, async (onProgress) => {
      onProgress("arp");
      const ip = (device.getSettings() as { ip?: string }).ip;
      const network = ip ? await collectNetworkForIp(homey, ip) : undefined;
      return generateDeviceReport({ device, ...environment(homey), network, onProgress });
    });

    return { runId };
  },

  async probeByIp({ homey, body }: ProbeIpArgs): Promise<{ runId: string }> {
    const ip = typeof body?.ip === "string" ? body.ip.trim() : "";
    if (!ip) throw new Error(homey.__("settings.error.ip_required"));
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error(homey.__("settings.error.ip_invalid", { ip }));

    const runId = randomUUID();
    runInBackground(homey, runId, async (onProgress) => {
      onProgress("arp_ip", { ip });
      const network = await collectNetworkForIp(homey, ip);
      return generateIpReport({ ip, ...environment(homey), network, onProgress });
    });

    return { runId };
  },
};

function environment(homey: Homey) {
  const manifest = homey.manifest as { version?: string } | undefined;
  return {
    appVersion: String(manifest?.version ?? "unknown"),
    homeyFirmwareVersion: typeof homey.version === "string" ? homey.version : undefined,
    homeyPlatform: typeof homey.platform === "string" ? homey.platform : undefined,
  };
}

function runInBackground(
  homey: Homey,
  runId: string,
  work: (onProgress: ProgressCallback) => Promise<DiagnosticReport>,
): void {
  // Best effort: if an emit fails, the settings page's watchdog reports the error.
  const emit = (event: string, payload: Record<string, unknown>) => {
    Promise.resolve()
      // Returned so a rejection lands in .catch() if realtime() is async (typed as any).
      .then(() => homey.api.realtime(event, { runId, ...payload }) as unknown)
      .catch((err: unknown) => homey.app.error(`[report] realtime emit ${event} failed`, err));
  };

  const onProgress: ProgressCallback = (key, tokens) =>
    emit(EVENT_PROGRESS, { message: homey.__(`settings.progress.${key}`, tokens) });

  work(onProgress)
    .then((report) => emit(EVENT_COMPLETE, { markdown: renderMarkdown(report) }))
    .catch((err: unknown) =>
      emit(EVENT_ERROR, { message: err instanceof Error ? err.message : String(err) }),
    );
}

async function collectNetworkForIp(homey: Homey, ip: string): Promise<NetworkSnapshot> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const mac = await Promise.race([
      homey.arp.getMAC(ip),
      new Promise<never>((_, reject) => {
        timer = homey.setTimeout(() => reject(new Error("ARP lookup timed out after 5s")), ARP_TIMEOUT_MS);
      }),
    ]);
    return { ip, arpMac: typeof mac === "string" && mac.length > 0 ? mac : undefined };
  } catch (err) {
    return { ip, arpError: humaniseArpError(err instanceof Error ? err.message : String(err)) };
  } finally {
    homey.clearTimeout(timer);
  }
}

function humaniseArpError(message: string): string {
  if (message.includes("ping")) return "Inverter did not respond to ARP probe (likely powered off)";
  if (message.includes("timed out")) return "ARP lookup timed out";
  return message;
}
