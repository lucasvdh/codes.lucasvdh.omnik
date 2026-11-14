/**
 * Probe the Omnik web interface for HTTP-based fallback paths.
 *
 * Some Omnik models (2000TL2, 2500TL, …) only expose data over HTTP, not over
 * TCP/8899. This script discovers which endpoints respond, with or without
 * basic auth, and tries to parse the legacy `myDeviceArray` JS payload.
 *
 * Run with:
 *   npx tsc && node .homeybuild/scripts/probe-webinterface.js <ip> [user] [password]
 *
 * Examples:
 *   node .homeybuild/scripts/probe-webinterface.js 192.168.1.13
 *   node .homeybuild/scripts/probe-webinterface.js 192.168.1.13 admin admin
 */
import http from "http";

interface ProbeResult {
  path: string;
  status: number | string;
  contentType?: string;
  bodyPreview: string;
  bodyLength: number;
}

const ENDPOINTS = [
  "/",
  "/js/status.js",
  "/status.html",
  "/status.json",
  "/cgi-bin/status",
  "/index.html",
];

async function fetchEndpoint(
  ip: string,
  path: string,
  auth?: { user: string; password: string }
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    if (auth) {
      const token = Buffer.from(`${auth.user}:${auth.password}`).toString("base64");
      headers["Authorization"] = `Basic ${token}`;
    }

    const req = http.get(
      { host: ip, port: 80, path, headers, timeout: 5000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            path,
            status: res.statusCode ?? "?",
            contentType: res.headers["content-type"],
            bodyPreview: body.length > 500 ? body.slice(0, 500) + "…" : body,
            bodyLength: body.length,
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({ path, status: "TIMEOUT", bodyPreview: "", bodyLength: 0 });
    });
    req.on("error", (err) => {
      resolve({ path, status: `ERR: ${err.message}`, bodyPreview: "", bodyLength: 0 });
    });
  });
}

/**
 * Parse `myDeviceArray[0] = "AANN4020...,V5.07Build252,V4.13Build262,Omnik4000tl ,4000,0,906,230795,,1,";`
 * style payloads. Field positions (from various Omnik web UIs):
 *   0: inverter S/N
 *   1: master firmware version
 *   2: slave firmware version
 *   3: model name
 *   4: rated power (W)
 *   5: ?
 *   6: current power (W)
 *   7: total energy (Wh, divide by 100 for kWh — varies per model)
 *   8: ?
 *   9: status flag
 */
function parseDeviceArray(js: string): Record<string, string | number> | null {
  const match = js.match(/myDeviceArray\s*\[\s*0\s*\]\s*=\s*"([^"]+)"/);
  if (!match) return null;
  const fields = match[1].split(",").map((f) => f.trim());
  return {
    rawCsv: match[1],
    serialNumber: fields[0] ?? "",
    masterFirmware: fields[1] ?? "",
    slaveFirmware: fields[2] ?? "",
    model: fields[3] ?? "",
    ratedPowerW: Number(fields[4]) || fields[4] || "",
    field5: fields[5] ?? "",
    currentPowerW: Number(fields[6]) || fields[6] || "",
    totalEnergyRaw: fields[7] ?? "",
    field8: fields[8] ?? "",
    statusFlag: fields[9] ?? "",
  };
}

function parseWebData(js: string): Record<string, string | number> | null {
  // Newer firmwares (omnik3000tl etc.) expose `webData = "..."` in /js/status.js.
  // Field layout discovered via live test on a 604... wifi-stick:
  //   0: inverter S/N (matches binary-protocol name field)
  //   1: master firmware version
  //   2: slave firmware version
  //   3: model name (e.g. "omnik3000tl")
  //   4: rated power (W)
  //   5: current AC power (W)
  //   6: today's energy in 0.01 kWh units
  //   7: lifetime energy in 0.1 kWh units
  //   8: (empty / unknown)
  //   9: status flag (1 = idle/no sun, 2 = generating, …)
  const match = js.match(/webData\s*=\s*"([^"]+)"/);
  if (!match) return null;
  const fields = match[1].split(",").map((f) => f.trim());
  const todayRaw = Number(fields[6]);
  const totalRaw = Number(fields[7]);
  return {
    rawCsv: match[1],
    serialNumber: fields[0] ?? "",
    masterFirmware: fields[1] ?? "",
    slaveFirmware: fields[2] ?? "",
    model: fields[3] ?? "",
    ratedPowerW: Number(fields[4]) || fields[4] || "",
    currentPowerW: Number(fields[5]) || fields[5] || "",
    todayEnergyKwh: Number.isFinite(todayRaw) ? todayRaw / 100 : "",
    totalEnergyKwh: Number.isFinite(totalRaw) ? totalRaw / 10 : "",
    statusFlag: fields[9] ?? "",
  };
}

/** Also extract the inline metadata that lives outside webData. */
function parseStatusJsMeta(js: string): Record<string, string> {
  const grab = (key: string) => {
    const m = js.match(new RegExp(`var\\s+${key}\\s*=\\s*"([^"]*)"`));
    return m ? m[1] : "";
  };
  return {
    version: grab("version"),
    m2mMid: grab("m2mMid"), // wifi-stick S/N (the binary-protocol input!)
    wlanMac: grab("wlanMac"),
    m2mRssi: grab("m2mRssi"),
    wanIp: grab("wanIp"),
    nmac: grab("nmac"),
  };
}

async function probe(ip: string, auth?: { user: string; password: string }) {
  const label = auth ? `with auth (${auth.user}:***)` : "no auth";
  console.log(`\n=== Probing ${ip} ${label} ===\n`);

  for (const path of ENDPOINTS) {
    const r = await fetchEndpoint(ip, path, auth);
    const ct = r.contentType ? ` [${r.contentType}]` : "";
    console.log(`${path}  →  ${r.status}${ct}  (${r.bodyLength} bytes)`);
    if (typeof r.status === "number" && r.status >= 200 && r.status < 300 && r.bodyLength) {
      console.log("  preview:");
      console.log(
        r.bodyPreview
          .split("\n")
          .map((l) => "    " + l)
          .join("\n")
      );
      const arr = parseDeviceArray(r.bodyPreview) ?? parseWebData(r.bodyPreview);
      if (arr) {
        console.log("  parsed device data:");
        console.log(JSON.stringify(arr, null, 2).split("\n").map((l) => "    " + l).join("\n"));
      }
      const meta = parseStatusJsMeta(r.bodyPreview);
      if (Object.values(meta).some(Boolean)) {
        console.log("  parsed metadata:");
        console.log(JSON.stringify(meta, null, 2).split("\n").map((l) => "    " + l).join("\n"));
      }
      console.log();
    }
  }
}

async function main() {
  const [ip, user, password] = process.argv.slice(2);
  if (!ip) {
    console.error("Usage: node probe-webinterface.js <ip> [user] [password]");
    process.exit(1);
  }

  await probe(ip);
  if (user && password) {
    await probe(ip, { user, password });
  } else {
    console.log("\nTip: re-run with credentials to test basic-auth-protected endpoints:");
    console.log(`  node ${process.argv[1]} ${ip} admin admin`);
  }
}

main().catch((err) => {
  console.error("✗ failed:", err);
  process.exit(1);
});
