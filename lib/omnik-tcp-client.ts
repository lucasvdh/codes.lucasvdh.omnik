import net from "node:net";
import {
  ParseError,
  TimeoutError,
  UnexpectedResponseError,
  classifySocketError,
} from "./errors";

/** Answers this short are an error or acknowledgement, never a data frame. */
const MIN_FRAME_BYTES = 70;

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
    // The S/N is sent as 4 bytes; a larger value would silently produce a broken frame.
    if (!Number.isInteger(serialNumber) || serialNumber <= 0 || serialNumber > 0xffffffff) {
      throw new RangeError(`WiFi module S/N ${serialNumber} does not fit in 32 bits`);
    }
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
  private readonly collectMs: number;

  constructor({
    address,
    wifiSn,
    port = 8899,
    timeoutMs = 10000,
    collectMs = 500,
  }: {
    address: string;
    wifiSn: number;
    port?: number;
    timeoutMs?: number;
    /** Quiet time after the last chunk before the frame is parsed. */
    collectMs?: number;
  }) {
    this.address = address;
    this.wifiSn = wifiSn;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.collectMs = collectMs;
  }

  getData(): Promise<InverterData> {
    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      const chunks: Buffer[] = [];
      let settled = false;
      let quietTimer: NodeJS.Timeout | undefined;
      // The idle timeout resets on every chunk; this one bounds the whole exchange.
      const deadline = setTimeout(() => finish(), this.timeoutMs * 2);

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        clearTimeout(quietTimer);
        client.destroy();
        fn();
      };

      // Parse what arrived, or explain why there is nothing usable.
      const finish = (noAnswer: () => Error = () => new TimeoutError()) => {
        const data = Buffer.concat(chunks);
        if (data.length === 0) return settle(() => reject(noAnswer()));
        if (data.length <= MIN_FRAME_BYTES) {
          return settle(() => reject(new UnexpectedResponseError(data.toString("hex"))));
        }
        try {
          const inverterData = OmnikProtocol.parseResponse(data);
          settle(() => resolve(inverterData));
        } catch (error) {
          settle(() =>
            reject(
              error instanceof ParseError
                ? error
                : new ParseError(error instanceof Error ? error.message : String(error)),
            ),
          );
        }
      };

      client.setTimeout(this.timeoutMs);

      // A frame can arrive in several chunks; parse once the stream has been quiet briefly.
      client.on("data", (data: Buffer) => {
        chunks.push(data);
        clearTimeout(quietTimer);
        quietTimer = setTimeout(() => finish(), this.collectMs);
      });

      client.on("timeout", () => finish());

      // Without this, a module that closes the connection without answering leaves the
      // promise pending forever and stops the poll loop.
      client.on("close", () =>
        finish(() => new UnexpectedResponseError("connection closed without data")),
      );

      client.on("error", (error: NodeJS.ErrnoException) => {
        settle(() => reject(classifySocketError(error)));
      });

      client.on("ready", () => {
        try {
          client.write(OmnikProtocol.buildRequest(this.wifiSn));
        } catch (error) {
          settle(() => reject(error instanceof Error ? error : new Error(String(error))));
        }
      });

      client.connect(this.port, this.address);
    });
  }
}

