import { randomUUID } from "crypto";
import {
  DiagnosticReport,
  ProgressCallback,
  generateDeviceReport,
  generateIpReport,
  renderMarkdown,
  NetworkSnapshot,
} from "./drivers/omnik-local/diagnostic";

const DRIVER_ID = "omnik-local";

/**
 * Event names used to push report progress/completion back to the settings
 * page. The settings page subscribes via `Homey.on(name, handler)` and filters
 * payloads by `runId`. Using one event name per kind (rather than embedding
 * runId in the name) means the page can subscribe once at page load and stays
 * resilient against the small race between starting a run and registering its
 * listeners.
 */
const EVENT_PROGRESS = "omnik:report:progress";
const EVENT_COMPLETE = "omnik:report:complete";
const EVENT_ERROR = "omnik:report:error";

interface ApiArgs {
  homey: any;
}

interface ReportArgs extends ApiArgs {
  body: { deviceId: string };
}

interface ProbeIpArgs extends ApiArgs {
  body: { ip: string };
}

interface DeviceLite {
  getName(): string;
  getData(): { id?: string | number } & Record<string, unknown>;
}

module.exports = {
  async listDevices({ homey }: ApiArgs): Promise<Array<{ id: string; name: string }>> {
    const driver = homey.drivers.getDriver(DRIVER_ID);
    return driver.getDevices().map((d: DeviceLite) => ({
      id: String(d.getData().id ?? d.getName()),
      name: d.getName(),
    }));
  },

  /**
   * Kick off a report for a paired device. Returns immediately with a runId
   * so the settings page isn't held hostage by Homey's API request timeout
   * (undocumented but observed to abort long-running probes). The actual
   * markdown is delivered via the `omnik:report:complete` realtime event.
   */
  async generateReport({ homey, body }: ReportArgs): Promise<{ runId: string }> {
    const driver = homey.drivers.getDriver(DRIVER_ID);
    const device = driver
      .getDevices()
      .find((d: DeviceLite) => String(d.getData().id ?? "") === body.deviceId);
    if (!device) {
      throw new Error(`No paired device found with id ${body.deviceId}`);
    }

    const runId = randomUUID();
    runInBackground(homey, runId, async (onProgress) => {
      onProgress("Looking up MAC via ARP…");
      const network = await collectNetwork(homey, device);
      return generateDeviceReport({
        device,
        appVersion: String(homey.manifest?.version ?? "unknown"),
        homeyFirmwareVersion: typeof homey.version === "string" ? homey.version : undefined,
        homeyPlatform: typeof homey.platform === "string" ? homey.platform : undefined,
        network,
        onProgress,
      });
    });

    return { runId };
  },

  async probeByIp({ homey, body }: ProbeIpArgs): Promise<{ runId: string }> {
    const ip = String(body?.ip ?? "").trim();
    if (!ip) throw new Error("ip is required");
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error(`"${ip}" doesn't look like an IPv4 address`);

    const runId = randomUUID();
    runInBackground(homey, runId, async (onProgress) => {
      onProgress(`Looking up MAC for ${ip} via ARP…`);
      const network = await collectNetworkForIp(homey, ip);
      return generateIpReport({
        ip,
        appVersion: String(homey.manifest?.version ?? "unknown"),
        homeyFirmwareVersion: typeof homey.version === "string" ? homey.version : undefined,
        homeyPlatform: typeof homey.platform === "string" ? homey.platform : undefined,
        network,
        onProgress,
      });
    });

    return { runId };
  },
};

function runInBackground(
  homey: any,
  runId: string,
  work: (onProgress: ProgressCallback) => Promise<DiagnosticReport>,
): void {
  const emit = (event: string, payload: Record<string, unknown>) => {
    Promise.resolve()
      .then(() => homey.api.realtime(event, { runId, ...payload }))
      .catch((err: unknown) => {
        // Realtime emit is best-effort; if it fails the settings page hits its
        // watchdog and surfaces an error. Log to app log so we can correlate.
        try {
          homey.app?.error?.(`realtime emit ${event} failed: ${(err as Error).message}`);
        } catch {
          // ignore
        }
      });
  };

  const onProgress: ProgressCallback = (message) => emit(EVENT_PROGRESS, { message });

  void (async () => {
    try {
      const report = await work(onProgress);
      emit(EVENT_COMPLETE, { markdown: renderMarkdown(report) });
    } catch (err) {
      emit(EVENT_ERROR, { message: (err as Error).message ?? String(err) });
    }
  })();
}

async function collectNetworkForIp(homey: any, ip: string): Promise<NetworkSnapshot> {
  try {
    const mac = await Promise.race([
      homey.arp.getMAC(ip),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("ARP lookup timed out after 5s")), 5000),
      ),
    ]);
    return { ip, arpMac: typeof mac === "string" && mac.length > 0 ? mac : undefined };
  } catch (err) {
    return { ip, arpError: humaniseArpError((err as Error).message) };
  }
}

async function collectNetwork(homey: any, device: any): Promise<NetworkSnapshot | undefined> {
  const settings = device.getSettings?.() ?? {};
  const ip: string | undefined = settings.ip;
  if (!ip) return undefined;
  return collectNetworkForIp(homey, ip);
}

function humaniseArpError(message: string): string {
  if (message.includes("ping")) return "Inverter did not respond to ARP probe (likely powered off)";
  if (message.includes("timed out")) return "ARP lookup timed out";
  return message;
}
