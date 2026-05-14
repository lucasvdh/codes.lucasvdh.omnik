"use strict";
import { Driver } from "homey";
import {
  HostUnreachableError,
  InverterAsleepError,
  OmnikLocalApi,
  ParseError,
  TimeoutError,
  UnauthorizedError,
  UnexpectedResponseError,
} from "./api";
import { OmnikHttpApi, HttpAuth, DiscoveryInfo } from "./http-api";
import { Device, DeviceProtocol } from "./types";

interface PairingState {
  ip: string | null;
  auth: HttpAuth | null;
  manualSn: number | null;
  discovery: DiscoveryInfo | null;
  protocol: DeviceProtocol | null;
}

class OmnikLocal extends Driver {
  async onInit(): Promise<void> {
    this.registerFlowConditions();
  }

  private registerFlowConditions(): void {
    this.homey.flow
      .getConditionCard("is_producing")
      .registerRunListener(async ({ device }: { device: any }) => {
        const power = device.getCapabilityValue("measure_power") as number | null;
        return typeof power === "number" && power > 0;
      });

    this.homey.flow
      .getConditionCard("power_above")
      .registerRunListener(async ({ device, watts }: { device: any; watts: number }) => {
        const power = device.getCapabilityValue("measure_power") as number | null;
        return typeof power === "number" && power > watts;
      });

    this.homey.flow
      .getConditionCard("daily_production_above")
      .registerRunListener(async ({ device, kwh }: { device: any; kwh: number }) => {
        const daily = device.getCapabilityValue("meter_power.daily") as number | null;
        return typeof daily === "number" && daily > kwh;
      });
  }

  async onPair(session: any) {
    const state: PairingState = {
      ip: null,
      auth: null,
      manualSn: null,
      discovery: null,
      protocol: null,
    };

    session.setHandler("setIpAddress", async (ip: string) => {
      state.ip = ip;
    });
    session.setHandler("getIpAddress", async () => state.ip);

    session.setHandler("submitAuth", async (auth: HttpAuth) => {
      state.auth = auth;
      await session.showView("probing");
    });

    session.setHandler("submitManualSn", async (sn: number) => {
      state.manualSn = sn;
      await session.showView("probing");
    });

    session.setHandler("showView", async (view: string) => {
      this.log("Show view", view);

      // When the user navigates back to the IP entry, drop the cached probe
      // results so the next attempt is a clean slate.
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

      try {
        const result = await this.discoverInverter(state.ip, state.auth, state.manualSn);
        state.discovery = result.discovery;
        state.protocol = result.protocol;
        await session.showView("confirm");
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          await session.showView("auth_required");
          return;
        }

        const message = this.translatePairError(error);

        // If the user already provided a manual S/N and TCP still failed,
        // bounce back to manual_entry so they can correct the S/N.
        if (state.manualSn !== null) {
          await this.flashError(session, message, "manual_entry");
          return;
        }

        // For "host unreachable" / "timeout" the IP itself is wrong or the
        // device is offline — TCP would fail for the same reason, so a manual
        // S/N entry won't help. Bounce back to the pair view.
        if (error instanceof HostUnreachableError || error instanceof TimeoutError) {
          await this.flashError(session, message, "pair");
          return;
        }

        // Inverter is asleep — manual S/N entry won't unstick it, the inverter
        // itself isn't reporting. Bounce back to the pair view so the user can
        // retry once the sun is up.
        if (error instanceof InverterAsleepError) {
          await this.flashError(session, message, "pair");
          return;
        }

        // Other failures (ParseError, UnexpectedResponseError) mean the host
        // responded but /js/status.js didn't give us a usable payload. TCP
        // may still work, so offer the manual S/N route.
        await session.showView("manual_entry");
        await session.emit("alert", message);
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

    session.setHandler("error", async (error: any) => {
      this.log("session.setHandler(error)", error);
    });

    session.setHandler("add_device_error", async (error: string) => {
      await this.flashError(session, error);
    });
  }

  /**
   * Discover the inverter and decide which protocol to use.
   *
   * 1. If a manual S/N was provided, skip HTTP and go straight to TCP.
   * 2. Otherwise: HTTP `/js/status.js` (optional auth) → m2mMid (S/N).
   * 3. With the discovered S/N, try TCP. Prefer TCP when it works (more
   *    capabilities: temperature, AC voltage). Fall back to HTTP for runtime
   *    data if TCP fails.
   */
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

    const wifiSn = Number(discovery.wifiStickSn);
    if (Number.isFinite(wifiSn) && wifiSn > 0) {
      try {
        const tcpApi = new OmnikLocalApi({ address: ip, wifiSn });
        const tcpData = await tcpApi.getData();
        // Prefer TCP — it surfaces temperature & per-phase voltage that HTTP doesn't.
        // Refresh discovery's data with the live TCP sample so the confirm view
        // can show the richer values.
        return {
          discovery: { ...discovery, data: tcpData },
          protocol: "tcp",
        };
      } catch (err) {
        this.log(`TCP probe failed (${(err as Error).message}); using HTTP protocol`);
      }
    }

    return { discovery, protocol: "http" };
  }

  private async flashError(session: any, message: string, returnTo: string = "pair"): Promise<void> {
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
