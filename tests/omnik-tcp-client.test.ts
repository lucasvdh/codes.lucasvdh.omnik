import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HostUnreachableError, TimeoutError, UnexpectedResponseError } from "../lib/errors";
import { OmnikLocalApi, OmnikProtocol } from "../lib/omnik-tcp-client";
import { buildFrame } from "./helpers/frames";
import { closedPort, fakeTcpServer } from "./helpers/fake-servers";

const SN = 1612345678;

describe("OmnikLocalApi", () => {
  it("sends the request frame for the configured S/N and parses the answer", async () => {
    let received: Buffer | undefined;
    const server = await fakeTcpServer((request, socket) => {
      received = request;
      socket.write(buildFrame({ powers: [800, 0, 0] }));
    });
    try {
      const api = new OmnikLocalApi({ address: "127.0.0.1", port: server.port, wifiSn: SN });
      const data = await api.getData();
      assert.equal(data.currentPower, 800);
      assert.deepEqual(received, OmnikProtocol.buildRequest(SN));
    } finally {
      await server.close();
    }
  });

  it("rejects a short answer (wrong S/N) with UnexpectedResponseError", async () => {
    const server = await fakeTcpServer((_request, socket) => socket.write(Buffer.alloc(40)));
    try {
      const api = new OmnikLocalApi({ address: "127.0.0.1", port: server.port, wifiSn: SN });
      await assert.rejects(api.getData(), UnexpectedResponseError);
    } finally {
      await server.close();
    }
  });

  it("rejects with TimeoutError when the module never answers", async () => {
    const server = await fakeTcpServer(() => undefined);
    try {
      const api = new OmnikLocalApi({ address: "127.0.0.1", port: server.port, wifiSn: SN, timeoutMs: 100 });
      await assert.rejects(api.getData(), TimeoutError);
    } finally {
      await server.close();
    }
  });

  it("maps a refused connection to HostUnreachableError", async () => {
    const api = new OmnikLocalApi({ address: "127.0.0.1", port: await closedPort(), wifiSn: SN });
    await assert.rejects(api.getData(), HostUnreachableError);
  });
});
