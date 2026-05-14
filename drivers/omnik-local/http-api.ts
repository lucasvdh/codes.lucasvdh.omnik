import http from "http";
import {
  HostUnreachableError,
  InverterAsleepError,
  InverterData,
  ParseError,
  TimeoutError,
  UnauthorizedError,
  UnexpectedResponseError,
} from "./api";

export interface HttpAuth {
  user: string;
  password: string;
}

export interface DiscoveryInfo {
  inverterName: string;
  model: string;
  /** WiFi-stick S/N (m2mMid). This is the value used as wifiSn for the binary protocol. */
  wifiStickSn: string;
  masterFirmware: string;
  slaveFirmware: string;
  data: InverterData;
}

interface StatusJsPayload {
  meta: {
    m2mMid: string;
    version: string;
    wlanMac: string;
  };
  webData: string[];
}

/**
 * Fallback API for inverters that expose `/js/status.js` over HTTP/80 but not
 * the binary protocol on TCP/8899 (or as a richer-pairing companion to the
 * binary path: it carries the WiFi-stick S/N as `m2mMid`).
 *
 * Compared to the binary protocol we lose AC voltage, AC frequency, PV
 * voltages and the inverter temperature. Those fields surface as `NaN` and are
 * filtered out by the device layer's `Number.isFinite` guards.
 *
 * Field layout for `webData = "..."`, discovered via live probe and matched
 * against [klaasnicolaas/python-omnikinverter] / [robbinjanssen/...]:
 *   [0] inverter S/N (e.g. NLDN3020136R1029)
 *   [1] master firmware (e.g. NL1-V1.0-0061-4)
 *   [2] slave firmware  (e.g. V2.0-0024)
 *   [3] model name      (e.g. omnik3000tl)
 *   [4] rated power (W)
 *   [5] current AC power (W)
 *   [6] today's energy in 0.01 kWh units
 *   [7] lifetime energy in 0.1 kWh units
 *   [9] status flag (1 = idle / 2,3 = generating)
 */
export class OmnikHttpApi {
  private readonly address: string;
  private readonly auth?: HttpAuth;
  private readonly timeoutMs: number;

  constructor({
    address,
    auth,
    timeoutMs = 10_000,
  }: {
    address: string;
    auth?: HttpAuth;
    timeoutMs?: number;
  }) {
    this.address = address;
    this.auth = auth;
    this.timeoutMs = timeoutMs;
  }

  async getData(): Promise<InverterData> {
    const { webData } = await this.fetchStatusJs();
    return OmnikHttpApi.parseInverterData(webData);
  }

  async discover(): Promise<DiscoveryInfo> {
    const { meta, webData } = await this.fetchStatusJs();
    if (!meta.m2mMid) {
      throw new ParseError("status.js missing m2mMid");
    }
    return {
      inverterName: webData[0] ?? "",
      model: (webData[3] ?? "").trim(),
      wifiStickSn: meta.m2mMid,
      masterFirmware: webData[1] ?? "",
      slaveFirmware: webData[2] ?? "",
      data: OmnikHttpApi.parseInverterData(webData),
    };
  }

  private async fetchStatusJs(): Promise<StatusJsPayload> {
    const body = await this.httpGet("/js/status.js");
    const meta = {
      m2mMid: this.extractVar(body, "m2mMid"),
      version: this.extractVar(body, "version"),
      wlanMac: this.extractVar(body, "wlanMac"),
    };
    try {
      return { meta, webData: this.extractWebData(body) };
    } catch (err) {
      // When the WiFi stick is alive (m2mMid present) but no inverter data is
      // exposed — typically `myDeviceArray = new Array();` with `yz_device_num`
      // = "0" — the inverter is asleep, not the firmware unsupported.
      if (err instanceof ParseError && meta.m2mMid && this.isInverterAsleep(body)) {
        throw new InverterAsleepError(meta.m2mMid);
      }
      throw err;
    }
  }

  private isInverterAsleep(body: string): boolean {
    const emptyArray = /myDeviceArray\s*=\s*new\s+Array\s*\(\s*\)\s*;/.test(body);
    const zeroDevices = /yz_device_num\s*=\s*"0"/.test(body);
    return emptyArray || zeroDevices;
  }

  static parseInverterData(webData: string[]): InverterData {
    if (webData.length < 8) {
      throw new ParseError(`webData has ${webData.length} fields, expected ≥8`);
    }

    const currentPower = Number(webData[5]);
    const todayRaw = Number(webData[6]);
    const totalRaw = Number(webData[7]);

    return {
      inverterName: (webData[0] ?? "").trim(),
      currentPower: Number.isFinite(currentPower) ? currentPower : 0,
      currentVoltage: NaN,
      currentFrequency: NaN,
      dailyProduction: Number.isFinite(todayRaw) ? todayRaw / 100 : NaN,
      totalProduction: Number.isFinite(totalRaw) ? totalRaw / 10 : NaN,
      currentTemperature: NaN,
    };
  }

  private extractVar(body: string, name: string): string {
    const m = body.match(new RegExp(`var\\s+${name}\\s*=\\s*"([^"]*)"`));
    return m ? m[1] : "";
  }

  private extractWebData(body: string): string[] {
    // The original Omnik firmware exposes a single comma-separated `webData`
    // variable. Newer firmware (e.g. omnik5000tl2 with WiFi firmware
    // H4.01.51MW, reported in issue #1) only exposes `myDeviceArray[0]="..."`
    // with the same field layout. Try both.
    const match =
      body.match(/webData\s*=\s*"([^"]*)"/) ??
      body.match(/myDeviceArray\s*\[\s*0\s*\]\s*=\s*"([^"]*)"/);
    if (!match) {
      throw new ParseError("status.js does not contain webData or myDeviceArray[0]");
    }
    return match[1].split(",").map((f) => f.trim());
  }

  private httpGet(path: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (this.auth) {
        const token = Buffer.from(`${this.auth.user}:${this.auth.password}`).toString("base64");
        headers["Authorization"] = `Basic ${token}`;
      }

      const req = http.get(
        { host: this.address, port: 80, path, headers, timeout: this.timeoutMs },
        (res) => {
          if (res.statusCode === 401) {
            res.resume();
            reject(new UnauthorizedError());
            return;
          }
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            reject(new UnexpectedResponseError(`HTTP ${res.statusCode}`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          res.on("error", reject);
        }
      );

      req.on("timeout", () => {
        req.destroy();
        reject(new TimeoutError());
      });
      req.on("error", (err: NodeJS.ErrnoException) => {
        const code = err.code ?? "";
        if (code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENETUNREACH") {
          reject(new HostUnreachableError(code));
        } else {
          reject(err);
        }
      });
    });
  }
}

export default OmnikHttpApi;
