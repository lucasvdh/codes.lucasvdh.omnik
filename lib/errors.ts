export class TimeoutError extends Error {
  constructor() {
    super("The connection timed out");
    this.name = "TimeoutError";
  }
}

export class HostUnreachableError extends Error {
  constructor(cause: string) {
    super(`Could not reach inverter: ${cause}`);
    this.name = "HostUnreachableError";
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Inverter web interface requires authentication");
    this.name = "UnauthorizedError";
  }
}

export class UnexpectedResponseError extends Error {
  constructor(response: string) {
    super("Unexpected response from inverter: " + response);
    this.name = "UnexpectedResponseError";
  }
}

export class ParseError extends Error {
  constructor(cause: string) {
    super("Failed to parse inverter data: " + cause);
    this.name = "ParseError";
  }
}

/**
 * The WiFi module responds but no inverter reports to it, usually because the inverter shut
 * down for lack of DC voltage (night, dawn, heavy cloud). Not a firmware problem.
 */
export class InverterAsleepError extends Error {
  constructor(public readonly wifiStickSn?: string) {
    super(
      wifiStickSn
        ? `WiFi module ${wifiStickSn} is reachable but no inverter data is available (inverter likely asleep)`
        : "WiFi module is reachable but no inverter data is available (inverter likely asleep)",
    );
    this.name = "InverterAsleepError";
  }
}

const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"]);

/** Maps a socket error to HostUnreachableError when the code says the host is not there. */
export function classifySocketError(error: NodeJS.ErrnoException): Error {
  const code = error.code ?? "";
  return UNREACHABLE_CODES.has(code) ? new HostUnreachableError(code) : error;
}

export function isRetryable(error: unknown): boolean {
  return (
    error instanceof TimeoutError ||
    error instanceof HostUnreachableError ||
    (error instanceof Error && /ECONNRESET|EPIPE|ETIMEDOUT/.test(error.message))
  );
}

/** Short technical description for logs and the unavailable reason. */
export function describeError(error: unknown): string {
  if (error instanceof TimeoutError) return "timeout";
  if (error instanceof Error) return error.message;
  return String(error);
}
