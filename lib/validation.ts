import { isIPv4 } from "node:net";

const MAX_WIFI_SN = 0xffffffff;

export function normalizeIpv4(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const ip = input.trim();
  return isIPv4(ip) ? ip : null;
}

/** The binary protocol sends the S/N as 4 bytes, so larger numbers can't be used. */
export function parseWifiSn(input: unknown): number | null {
  const text = typeof input === "number" ? String(input) : typeof input === "string" ? input.trim() : "";
  if (!/^\d+$/.test(text)) return null;
  const sn = Number(text);
  return sn > 0 && sn <= MAX_WIFI_SN ? sn : null;
}
