/** "ac:cf:23:11:b4:0d", "ACCF2311B40D" and "ac-cf-..." all become "AC:CF:23:11:B4:0D". */
export function normalizeMac(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const hex = input.replace(/[:\-.\s]/g, "").toUpperCase();
  return /^[0-9A-F]{12}$/.test(hex) ? (hex.match(/../g) ?? []).join(":") : null;
}

/** The new IP for a device whose module (by MAC) was seen at another address, else null. */
export function movedAddress(
  storedMac: unknown,
  seenMac: unknown,
  seenAddress: string,
  currentIp: string,
): string | null {
  const stored = normalizeMac(storedMac);
  if (!stored || stored !== normalizeMac(seenMac)) return null;
  return seenAddress && seenAddress !== currentIp.trim() ? seenAddress : null;
}

/** Implemented by devices that follow their WiFi module when it gets a new IP. */
export interface FollowsModuleAddress {
  followModuleAddress(mac: string, address: string): Promise<void>;
}

export function followsModuleAddress(device: object): device is FollowsModuleAddress {
  return typeof (device as Partial<FollowsModuleAddress>).followModuleAddress === "function";
}
