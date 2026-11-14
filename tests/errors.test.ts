import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HostUnreachableError,
  ParseError,
  TimeoutError,
  UnauthorizedError,
  classifySocketError,
  describeError,
  isRetryable,
} from "../lib/errors";

describe("isRetryable", () => {
  it("retries timeouts, unreachable hosts and transient socket errors", () => {
    assert.equal(isRetryable(new TimeoutError()), true);
    assert.equal(isRetryable(new HostUnreachableError("EHOSTUNREACH")), true);
    assert.equal(isRetryable(new Error("read ECONNRESET")), true);
  });

  it("does not retry auth and parse failures", () => {
    assert.equal(isRetryable(new UnauthorizedError()), false);
    assert.equal(isRetryable(new ParseError("bad")), false);
  });
});

describe("classifySocketError", () => {
  it("maps refused and unreachable codes to HostUnreachableError", () => {
    for (const code of ["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EHOSTDOWN", "ENOTFOUND"]) {
      const err = Object.assign(new Error(code), { code });
      assert.ok(classifySocketError(err) instanceof HostUnreachableError, code);
    }
  });

  it("maps a connect timeout to TimeoutError so pairing sends the user back to the IP", () => {
    const err = Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
    assert.ok(classifySocketError(err) instanceof TimeoutError);
  });

  it("passes other errors through", () => {
    const err = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    assert.equal(classifySocketError(err), err);
  });
});

describe("describeError", () => {
  it("is short for timeouts and uses the message otherwise", () => {
    assert.equal(describeError(new TimeoutError()), "timeout");
    assert.equal(describeError(new Error("boom")), "boom");
    assert.equal(describeError("plain"), "plain");
  });
});
