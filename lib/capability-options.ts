import { isDeepStrictEqual } from "node:util";

export function capabilityOptionsDiffer(
  current: Record<string, unknown> | undefined,
  wanted: Record<string, unknown>,
): boolean {
  return Object.entries(wanted).some(([key, value]) => !isDeepStrictEqual(current?.[key], value));
}
