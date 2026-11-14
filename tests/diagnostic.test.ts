import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactStatusJs } from "../lib/diagnostic";

describe("redactStatusJs", () => {
  it("removes Wi-Fi names, keys and the WAN address from the raw status.js", () => {
    const body = [
      'var cover_sta_ssid = "MyHomeWifi";',
      'var cover_ap_key="secret123";',
      'var cover_wan_ip = "203.0.113.7";',
      'var m2mMid ="1600000001";',
      'var webData="NLDN0000000000000,x,y,omnik3000tl,3000,10,20,30,,1";',
    ].join("\n");
    const redacted = redactStatusJs(body);
    assert.ok(!redacted.includes("MyHomeWifi"));
    assert.ok(!redacted.includes("secret123"));
    assert.ok(!redacted.includes("203.0.113.7"));
    assert.ok(redacted.includes('var cover_sta_ssid = "<redacted>";'));
    assert.ok(redacted.includes('"1600000001"'), "keeps the fields needed for debugging");
    assert.ok(redacted.includes("omnik3000tl"));
  });
});
