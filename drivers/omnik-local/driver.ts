import Homey from "homey";
import type PairSession from "homey/lib/PairSession";
import {
  HostUnreachableError,
  InverterAsleepError,
  ParseError,
  TimeoutError,
  UnauthorizedError,
  UnexpectedResponseError,
  describeError,
} from "../../lib/errors";
import { OmnikHttpApi, type DiscoveryInfo, type HttpAuth } from "../../lib/omnik-http-client";
import { OmnikLocalApi } from "../../lib/omnik-tcp-client";
import type { Device, DeviceProtocol } from "../../lib/types";
import { normalizeIpv4, parseWifiSn } from "../../lib/validation";

type DeviceArg = { device: Homey.Device };

interface PairingState {
  ip: string | null;
  auth: HttpAuth | null;
  manualSn: number | null;
  discovery: DiscoveryInfo | null;
  protocol: DeviceProtocol | null;
  probing: boolean;
}

class OmnikLocal extends Homey.Driver {
  async onInit(): Promise<void> {
    this.registerFlowConditions();
  }

  private registerFlowConditions(): void {
    this.homey.flow
      .getConditionCard("is_producing")
      .registerRunListener(async ({ device }: DeviceArg) => {
        const power = device.getCapabilityValue("measure_power") as number | null;
        return typeof power === "number" && power > 0;
      });

    this.homey.flow
      .getConditionCard("power_above")
      .registerRunListener(async ({ device, watts }: DeviceArg & { watts: number }) => {
        const power = device.getCapabilityValue("measure_power") as number | null;
        return typeof power === "number" && power > watts;
      });

    this.homey.flow
      .getConditionCard("daily_production_above")
      .registerRunListener(async ({ device, kwh }: DeviceArg & { kwh: number }) => {
        const daily = device.getCapabilityValue("meter_power.daily") as number | null;
        return typeof daily === "number" && daily > kwh;
      });
  }

  async onPair(session: PairSession): Promise<void> {
    const state: PairingState = {
      ip: null,
      auth: null,
      manualSn: null,
      discovery: null,
      protocol: null,
      probing: false,
    };

    session.setHandler("setIpAddress", async (ip: string) => {
      state.ip = ip;
    });
    session.setHandler("getIpAddress", async () => state.ip);

    session.setHandler("submitAuth", async (auth: HttpAuth) => {
      state.auth = auth;
      await session.showView("probing");
    });

    session.setHandler("submitManualSn", async (sn: unknown) => {
      const wifiSn = parseWifiSn(sn);
      if (wifiSn === null) {
        await this.flashError(session, this.homey.__("error.invalid_wifi_sn"), "manual_entry");
        return;
      }
      state.manualSn = wifiSn;
      await session.showView("probing");
    });

    session.setHandler("showView", async (view: string) => {
      this.log("[pair] show view", view);

      // Back on the IP screen: forget the previous attempt.
      if (view === "pair") {
        state.auth = null;
        state.manualSn = null;
        state.discovery = null;
        state.protocol = null;
        return;
      }

      if (view !== "probing") return;

      if (!state.ip) {
        await this.flashError(session, this.homey.__("pair.omnik-local.error.missing_ip_address"));
        return;
      }
      const ip = normalizeIpv4(state.ip);
      if (!ip) {
        await this.flashError(session, this.homey.__("error.invalid_ip"));
        return;
      }
      state.ip = ip;

      // A double tap on a submit button must not start a second discovery.
      if (state.probing) return;
      state.probing = true;
      try {
        const result = await this.discoverInverter(state.ip, state.auth, state.manualSn);
        state.discovery = result.discovery;
        state.protocol = result.protocol;
        await session.showView("confirm");
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          if (state.auth) {
            await this.flashError(session, this.homey.__("pair.omnik-local.error.auth_failed"), "auth_required");
          } else {
            await session.showView("auth_required");
          }
          return;
        }

        const message = this.translatePairError(error);

        // A manual S/N that still fails is most likely mistyped.
        if (state.manualSn !== null) {
          await this.flashError(session, message, "manual_entry");
          return;
        }

        // A wrong IP, an offline module or a sleeping inverter: a manual S/N won't help.
        if (
          error instanceof HostUnreachableError ||
          error instanceof TimeoutError ||
          error instanceof InverterAsleepError
        ) {
          await this.flashError(session, message, "pair");
          return;
        }

        // The module answered but status.js was unusable; TCP with a manual S/N may still work.
        await session.showView("manual_entry");
        await session.emit("alert", message);
      } finally {
        state.probing = false;
      }
    });

    session.setHandler("getDiscovery", async () => {
      if (!state.discovery || !state.protocol) return null;
      return {
        inverterName: state.discovery.inverterName,
        model: state.discovery.model,
        protocol: state.protocol,
        currentPower: state.discovery.data.currentPower,
        dailyProduction: state.discovery.data.dailyProduction,
        totalProduction: state.discovery.data.totalProduction,
      };
    });

    session.setHandler("getDevice", async (): Promise<Device | null> => {
      if (!state.discovery || !state.protocol || !state.ip) return null;
      return {
        name: state.discovery.inverterName || "Omnik",
        data: {
          id: Number(state.discovery.wifiStickSn),
        },
        settings: {
          ip: state.ip,
          interval: 5,
          protocol: state.protocol,
          wifi_sn: state.discovery.wifiStickSn,
          http_user: state.auth?.user ?? "",
          http_password: state.auth?.password ?? "",
          offline_behavior: "keep_available",
        },
      };
    });

    session.setHandler("error", async (error: unknown) => {
      this.log("[pair] view reported error", error);
    });

    session.setHandler("add_device_error", async (error: string) => {
      await this.flashError(session, error);
    });
  }

  /** A manual S/N goes straight to TCP; otherwise status.js gives the S/N and TCP is preferred. */
  private async discoverInverter(
    ip: string,
    auth: HttpAuth | null,
    manualSn: number | null
  ): Promise<{ discovery: DiscoveryInfo; protocol: DeviceProtocol }> {
    if (manualSn !== null) {
      const tcpApi = new OmnikLocalApi({ address: ip, wifiSn: manualSn });
      const tcpData = await tcpApi.getData();
      return {
        discovery: {
          inverterName: tcpData.inverterName,
          model: "",
          wifiStickSn: String(manualSn),
          masterFirmware: "",
          slaveFirmware: "",
          data: tcpData,
        },
        protocol: "tcp",
      };
    }

    const httpApi = new OmnikHttpApi({ address: ip, auth: auth ?? undefined });
    const discovery = await httpApi.discover();

    // The S/N becomes the device id (a number), so it must be numeric.
    if (!/^\d+$/.test(discovery.wifiStickSn)) {
      throw new ParseError(`m2mMid "${discovery.wifiStickSn}" is not numeric`);
    }

    // S/Ns above 32 bits (some 604/646 modules) can't be sent over TCP; those stay on HTTP.
    const wifiSn = parseWifiSn(discovery.wifiStickSn);
    if (wifiSn !== null) {
      try {
        const tcpApi = new OmnikLocalApi({ address: ip, wifiSn });
        const tcpData = await tcpApi.getData();
        // TCP also delivers voltage, frequency and temperature.
        return {
          discovery: { ...discovery, data: tcpData },
          protocol: "tcp",
        };
      } catch (err) {
        this.log(`[pair] TCP probe failed (${describeError(err)}); using HTTP protocol`);
      }
    }

    return { discovery, protocol: "http" };
  }

  private async flashError(session: PairSession, message: string, returnTo = "pair"): Promise<void> {
    await session.showView(returnTo);
    await session.emit("alert", message);
  }

  private translatePairError(error: unknown): string {
    if (error instanceof TimeoutError) {
      return this.homey.__("pair.omnik-local.error.connection_timed_out");
    }
    if (error instanceof HostUnreachableError) {
      return this.homey.__("pair.omnik-local.error.host_unreachable");
    }
    if (error instanceof InverterAsleepError) {
      return this.homey.__("pair.omnik-local.error.inverter_asleep");
    }
    if (error instanceof UnexpectedResponseError || error instanceof ParseError) {
      return this.homey.__("pair.omnik-local.error.unexpected_response");
    }
    return this.homey.__("error.generic");
  }
}

module.exports = OmnikLocal;
