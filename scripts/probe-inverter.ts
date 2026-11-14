/**
 * Live probe against a real Omnik inverter.
 * Run with: npx ts-node scripts/probe-inverter.ts <ip> <wifi-sn>
 */
import net from "net";
import { OmnikLocalApi, OmnikProtocol } from "../lib/omnik-tcp-client";

async function main() {
  const [ip, snArg] = process.argv.slice(2);
  if (!ip || !snArg) {
    console.error("Usage: ts-node scripts/probe-inverter.ts <ip> <wifi-sn>");
    process.exit(1);
  }
  const sn = Number(snArg);

  console.log(`→ probing ${ip} (sn=${sn})`);
  console.log(`  request bytes: ${OmnikProtocol.buildRequest(sn).toString("hex")}`);

  // First, capture raw bytes via a parallel connection so we can hex-dump the response
  // alongside the parsed values.
  const raw: Buffer = await new Promise((resolve, reject) => {
    const sock = new net.Socket();
    sock.setTimeout(10_000);
    sock.on("data", (chunk) => {
      sock.destroy();
      resolve(chunk);
    });
    sock.on("timeout", () => {
      sock.destroy();
      reject(new Error("timeout capturing raw response"));
    });
    sock.on("error", (err) => {
      sock.destroy();
      reject(err);
    });
    sock.on("ready", () => sock.write(OmnikProtocol.buildRequest(sn)));
    sock.connect(8899, ip);
  });

  console.log(`← response: ${raw.length} bytes`);
  console.log(`  hex: ${raw.toString("hex")}`);

  console.log("\noffset map:");
  console.log(`  [15..30] name        = ${JSON.stringify(raw.subarray(15, 31).toString().replace(/\0+$/, ""))}`);
  console.log(`  [31]     temperature = readInt16BE   ${raw.readInt16BE(31)}  → ${raw.readInt16BE(31) / 10} °C`);
  console.log(`  [33]     pv1 voltage = readInt16BE   ${raw.readInt16BE(33)}  → ${raw.readInt16BE(33) / 10} V`);
  console.log(`  [35]     pv2 voltage = readInt16BE   ${raw.readInt16BE(35)}  → ${raw.readInt16BE(35) / 10} V`);
  console.log(`  [37]     pv3 voltage = readInt16BE   ${raw.readInt16BE(37)}  → ${raw.readInt16BE(37) / 10} V`);
  console.log(`  [51]     ac l1 V     = readInt16BE   ${raw.readInt16BE(51)}  → ${raw.readInt16BE(51) / 10} V`);
  console.log(`  [53]     ac l2 V     = readInt16BE   ${raw.readInt16BE(53)}  → ${raw.readInt16BE(53) / 10} V`);
  console.log(`  [55]     ac l3 V     = readInt16BE   ${raw.readInt16BE(55)}  → ${raw.readInt16BE(55) / 10} V`);
  console.log(`  [59]     ac l1 W     = readInt16BE   ${raw.readInt16BE(59)} W`);
  console.log(`  [63]     ac l2 W     = readInt16BE   ${raw.readInt16BE(63)} W`);
  console.log(`  [67]     ac l3 W     = readInt16BE   ${raw.readInt16BE(67)} W`);
  console.log(`  [69]     E-Today     = readUInt16BE  ${raw.readUInt16BE(69)} → ${raw.readUInt16BE(69) / 100} kWh`);
  console.log(`  [71]     E-Total     = readUInt32BE  ${raw.readUInt32BE(71)} → ${raw.readUInt32BE(71) / 10} kWh`);
  if (raw.length >= 79) {
    console.log(`  [75]     hours       = readUInt32BE  ${raw.readUInt32BE(75)} h`);
  }

  console.log("\nparsed via OmnikProtocol.parseResponse:");
  console.log(OmnikProtocol.parseResponse(raw));

  console.log("\nparsed via OmnikLocalApi.getData() (full request/parse cycle):");
  const api = new OmnikLocalApi({ address: ip, wifiSn: sn });
  console.log(await api.getData());
}

main().catch((err) => {
  console.error("✗ failed:", err);
  process.exit(1);
});
