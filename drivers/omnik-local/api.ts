import net from "net";

export class TimeoutError extends Error {
  constructor() {
    super("The connection timed out");
  }
}

export class HostUnreachableError extends Error {
  constructor(cause: string) {
    super(`Could not reach inverter: ${cause}`);
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Inverter web interface requires authentication");
  }
}

export class UnexpectedResponseError extends Error {
  constructor(response: string) {
    super("Unexpected response from inverter: " + response);
  }
}

export class ParseError extends Error {
  constructor(cause: string) {
    super("Failed to parse inverter data: " + cause);
  }
}

/**
 * Raised when the WiFi module responds but no inverter is currently reporting
 * to it — typically because the inverter has shut itself down due to
 * insufficient DC voltage (night, dawn, heavy cloud). Distinct from ParseError
 * so the pairing / runtime layer can render a user-friendly message instead of
 * the generic "unsupported firmware" copy.
 */
export class InverterAsleepError extends Error {
  constructor(public readonly wifiStickSn?: string) {
    super(
      wifiStickSn
        ? `WiFi module ${wifiStickSn} is reachable but no inverter data is available (inverter likely asleep)`
        : "WiFi module is reachable but no inverter data is available (inverter likely asleep)",
    );
  }
}

export interface InverterData {
  inverterName: string;
  currentPower: number;
  currentVoltage: number;
  currentFrequency: number;
  dailyProduction: number;
  totalProduction: number;
  currentTemperature: number;
}

export class OmnikProtocol {
  /**
   * Build the binary request frame the Omnik WiFi logger expects on TCP/8899.
   *
   * Frame layout (20 bytes):
   *   [0..3]   magic header   0x68 0x02 0x40 0x30
   *   [4..7]   serial bytes   logger S/N as little-endian hex
   *   [8..11]  serial bytes   same S/N repeated
   *   [12..13] command        0x01 0x00
   *   [14]     checksum       (115 + sum of bytes 4..11) low byte
   *   [15]     terminator     0x16
   */
  static buildRequest(serialNumber: number): Buffer {
    const buffer = Buffer.alloc(16);
    buffer[0] = 0x68;
    buffer[1] = 0x02;
    buffer[2] = 0x40;
    buffer[3] = 0x30;

    const doubleHex = serialNumber.toString(16).padStart(8, "0").repeat(2);
    for (let i = 0; i < 8; i++) {
      const byte = parseInt(doubleHex.substring((7 - i) * 2, (7 - i) * 2 + 2), 16);
      buffer[4 + i] = byte;
    }

    buffer[12] = 0x01;
    buffer[13] = 0x00;

    let checksum = 115;
    for (let i = 4; i < 12; i++) checksum += buffer[i];
    buffer[14] = checksum & 0xff;
    buffer[15] = 0x16;

    return buffer;
  }

  /**
   * Parse a response frame from the Omnik WiFi logger.
   *
   * Offsets follow the open-source InverterMsg format used by Woutrrr/Omnik-Data-Logger:
   *   15..30  ASCII inverter name (16 bytes)
   *   31      inverter temperature (Int16BE, /10 °C)
   *   51..56  AC voltages L1/L2/L3 (Int16BE, /10 V) — averaged across positive phases
   *   57      AC frequency (UInt16BE, /100 Hz)
   *   59..68  AC powers L1/L2/L3 (Int16BE, W) — summed (positive phases only)
   *   69      E-Today (UInt16BE, /100 kWh)
   *   71      E-Total (UInt32BE, /10 kWh, lifetime cumulative)
   */
  static parseResponse(data: Buffer): InverterData {
    if (data.length < 75) {
      throw new ParseError(`response too short (${data.length} bytes)`);
    }

    const inverterName = data.subarray(15, 31).toString().replace(/\0+$/, "").trim();

    const phasePowers = [59, 63, 67]
      .map((offset) => data.readInt16BE(offset))
      .filter((v) => v > 0);
    const phaseVoltages = [51, 53, 55]
      .map((offset) => data.readInt16BE(offset))
      .filter((v) => v > 0);

    const currentPower = phasePowers.reduce((sum, v) => sum + v, 0);
    const currentVoltage = phaseVoltages.length
      ? phaseVoltages.reduce((sum, v) => sum + v, 0) / phaseVoltages.length / 10
      : 0;

    // Sensors that are unset/unsupported send 0xFFFF (UInt16) or 0xFFFFFFFF (UInt32).
    // Clamp those to NaN so the device layer can ignore them instead of writing
    // 655.35 kWh or 429496729.5 kWh into the meter.
    const rawFreq = data.readUInt16BE(57);
    const rawDaily = data.readUInt16BE(69);
    const rawTotal = data.readUInt32BE(71);
    const rawTemp = data.readInt16BE(31);
    const currentFrequency = rawFreq === 0xffff ? NaN : rawFreq / 100;
    const dailyProduction = rawDaily === 0xffff ? NaN : rawDaily / 100;
    const totalProduction = rawTotal === 0xffffffff ? NaN : rawTotal / 10;
    const currentTemperature = rawTemp === -1 ? NaN : rawTemp / 10;

    return {
      inverterName,
      currentPower,
      currentVoltage,
      currentFrequency,
      dailyProduction,
      totalProduction,
      currentTemperature,
    };
  }
}

export class OmnikLocalApi {
  private readonly address: string;
  private readonly wifiSn: number;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor({
    address,
    wifiSn,
    port = 8899,
    timeoutMs = 10000,
  }: {
    address: string;
    wifiSn: number;
    port?: number;
    timeoutMs?: number;
  }) {
    this.address = address;
    this.wifiSn = wifiSn;
    this.port = port;
    this.timeoutMs = timeoutMs;
  }

  getData(): Promise<InverterData> {
    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        client.destroy();
        fn();
      };

      client.setTimeout(this.timeoutMs);

      client.on("data", (data: Buffer) => {
        try {
          if (data.length <= 70) {
            settle(() => reject(new UnexpectedResponseError(data.toString("hex"))));
            return;
          }
          const inverterData = OmnikProtocol.parseResponse(data);
          settle(() => resolve(inverterData));
        } catch (error) {
          settle(() =>
            reject(
              error instanceof ParseError
                ? error
                : new ParseError(error instanceof Error ? error.message : String(error))
            )
          );
        }
      });

      client.on("timeout", () => settle(() => reject(new TimeoutError())));

      client.on("error", (error: NodeJS.ErrnoException) => {
        const code = error.code ?? "";
        if (code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENETUNREACH") {
          settle(() => reject(new HostUnreachableError(code)));
        } else {
          settle(() => reject(error));
        }
      });

      client.on("ready", () => {
        try {
          client.write(OmnikProtocol.buildRequest(this.wifiSn));
        } catch (error) {
          settle(() => reject(error));
        }
      });

      client.connect(this.port, this.address);
    });
  }
}

export default OmnikLocalApi;
