import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HostUnreachableError,
  InverterAsleepError,
  ParseError,
  TimeoutError,
  UnauthorizedError,
  UnexpectedResponseError,
} from "../lib/errors";
import { OmnikHttpApi } from "../lib/omnik-http-client";
import { closedPort, fakeHttpServer } from "./helpers/fake-servers";

// Sanitized status.js shapes; serials and MACs are made up.
const FIELDS = "NLDN0000000000000,NL1-V1.0-0000-4,V2.0-0000,omnik3000tl,3000,1520,1234,98765,,2";
const META = 'var m2mMid ="1600000001";\nvar version="H4.01.00Y0.0000W1.0.00(2018-01-01-A)";\nvar wlanMac="AA:BB:CC:00:00:01";\n';
const LEGACY_BODY = `${META}var webData="${FIELDS}";\n`;
const MY_DEVICE_ARRAY_BODY = `${META}var myDeviceArray=new Array();\nmyDeviceArray[0]="${FIELDS}";\n`;
const ASLEEP_BODY = `${META}var yz_device_num="0";\nvar myDeviceArray=new Array();\n`;

async function withStatusJs(
  respond: { status?: number; body?: string; hang?: boolean },
  run: (api: (opts?: { user?: string; timeoutMs?: number }) => OmnikHttpApi) => Promise<void>,
  onAuth?: (header: string | undefined) => void,
) {
  const server = await fakeHttpServer((req, res) => {
    onAuth?.(req.headers.authorization);
    if (respond.hang) return;
    res.writeHead(req.url === "/js/status.js" ? (respond.status ?? 200) : 404);
    res.end(respond.body ?? "");
  });
  try {
    await run(
      (opts = {}) =>
        new OmnikHttpApi({
          address: "127.0.0.1",
          port: server.port,
          timeoutMs: opts.timeoutMs,
          auth: opts.user ? { user: opts.user, password: "secret" } : undefined,
        }),
    );
  } finally {
    await server.close();
  }
}

describe("OmnikHttpApi.parseInverterData", () => {
  it("reads power, today and total from the webData fields", () => {
    const data = OmnikHttpApi.parseInverterData(FIELDS.split(","));
    assert.equal(data.currentPower, 1520);
    assert.equal(data.dailyProduction, 12.34);
    assert.equal(data.totalProduction, 9876.5);
    assert.ok(Number.isNaN(data.currentVoltage), "HTTP has no voltage");
    assert.ok(Number.isNaN(data.currentTemperature), "HTTP has no temperature");
  });

  it("throws ParseError with fewer than 8 fields", () => {
    assert.throws(() => OmnikHttpApi.parseInverterData(["a", "b"]), ParseError);
  });
});

describe("OmnikHttpApi over HTTP", () => {
  it("discovers the WiFi module S/N and model from legacy webData", async () => {
    await withStatusJs({ body: LEGACY_BODY }, async (api) => {
      const info = await api().discover();
      assert.equal(info.wifiStickSn, "1600000001");
      assert.equal(info.model, "omnik3000tl");
      assert.equal(info.data.currentPower, 1520);
    });
  });

  it("accepts myDeviceArray[0] when the firmware has no webData (#1)", async () => {
    await withStatusJs({ body: MY_DEVICE_ARRAY_BODY }, async (api) => {
      const data = await api().getData();
      assert.equal(data.currentPower, 1520);
    });
  });

  it("reports an asleep inverter instead of a parse error when the module lists no devices", async () => {
    await withStatusJs({ body: ASLEEP_BODY }, async (api) => {
      await assert.rejects(api().discover(), InverterAsleepError);
    });
  });

  it("throws ParseError when status.js has neither webData nor m2mMid", async () => {
    await withStatusJs({ body: "var foo=1;" }, async (api) => {
      await assert.rejects(api().getData(), ParseError);
    });
  });

  it("maps 401 to UnauthorizedError and other statuses to UnexpectedResponseError", async () => {
    await withStatusJs({ status: 401 }, async (api) => {
      await assert.rejects(api().getData(), UnauthorizedError);
    });
    await withStatusJs({ status: 500 }, async (api) => {
      await assert.rejects(api().getData(), UnexpectedResponseError);
    });
  });

  it("sends basic auth when credentials are configured", async () => {
    let header: string | undefined;
    await withStatusJs(
      { body: LEGACY_BODY },
      async (api) => {
        await api({ user: "admin" }).getData();
      },
      (h) => (header = h),
    );
    assert.equal(header, `Basic ${Buffer.from("admin:secret").toString("base64")}`);
  });

  it("times out when the module accepts the connection but never answers", async () => {
    await withStatusJs({ hang: true }, async (api) => {
      await assert.rejects(api({ timeoutMs: 100 }).getData(), TimeoutError);
    });
  });

  it("maps a refused connection to HostUnreachableError", async () => {
    const api = new OmnikHttpApi({ address: "127.0.0.1", port: await closedPort() });
    await assert.rejects(api.getData(), HostUnreachableError);
  });
});
