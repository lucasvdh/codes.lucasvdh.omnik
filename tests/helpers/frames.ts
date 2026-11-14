// Builds synthetic TCP/8899 response frames using the offsets OmnikProtocol.parseResponse reads.

export interface FrameValues {
  name?: string;
  temperatureRaw?: number; // Int16BE, /10 °C
  voltagesRaw?: [number, number, number]; // Int16BE, /10 V
  frequencyRaw?: number; // UInt16BE, /100 Hz
  powers?: [number, number, number]; // Int16BE, W
  dailyRaw?: number; // UInt16BE, /100 kWh
  totalRaw?: number; // UInt32BE, /10 kWh
}

export function buildFrame(values: FrameValues = {}, length = 99): Buffer {
  const frame = Buffer.alloc(length);
  frame.write((values.name ?? "TESTINVERTER0001").padEnd(16, "\0").slice(0, 16), 15, "ascii");
  frame.writeInt16BE(values.temperatureRaw ?? 312, 31);
  const [v1, v2, v3] = values.voltagesRaw ?? [2301, 0, 0];
  frame.writeInt16BE(v1, 51);
  frame.writeInt16BE(v2, 53);
  frame.writeInt16BE(v3, 55);
  frame.writeUInt16BE(values.frequencyRaw ?? 5001, 57);
  const [p1, p2, p3] = values.powers ?? [1234, 0, 0];
  frame.writeInt16BE(p1, 59);
  frame.writeInt16BE(p2, 63);
  frame.writeInt16BE(p3, 67);
  frame.writeUInt16BE(values.dailyRaw ?? 1250, 69);
  frame.writeUInt32BE(values.totalRaw ?? 123456, 71);
  return frame;
}
