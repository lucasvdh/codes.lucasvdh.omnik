import { isDeepStrictEqual } from "node:util";

/** True when any option in `wanted` is missing from or different in `current`. */
export function capabilityOptionsDiffer(
  current: Record<string, unknown> | undefined,
  wanted: Record<string, unknown>,
): boolean {
  return Object.entries(wanted).some(([key, value]) => !isDeepStrictEqual(current?.[key], value));
}
