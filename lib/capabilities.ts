import type { DeviceProtocol } from "./types";

/** Readings only the binary protocol delivers; over HTTP they would always show "-". */
export const TCP_ONLY_CAPABILITIES = ["measure_voltage", "measure_frequency", "measure_temperature"];

export function capabilityChanges(
  protocol: DeviceProtocol,
  present: string[],
  wanted: string[],
): { add: string[]; remove: string[] } {
  const target = protocol === "http" ? wanted.filter((c) => !TCP_ONLY_CAPABILITIES.includes(c)) : wanted;
  return {
    add: target.filter((c) => !present.includes(c)),
    remove: protocol === "http" ? present.filter((c) => TCP_ONLY_CAPABILITIES.includes(c)) : [],
  };
}
