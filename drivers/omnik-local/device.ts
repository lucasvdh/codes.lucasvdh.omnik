import { describeError, isRetryable } from "../../lib/errors";
import { InverterDevice } from "../../lib/inverter-device";
import { OmnikHttpApi } from "../../lib/omnik-http-client";
import { OmnikLocalApi, type InverterData } from "../../lib/omnik-tcp-client";
import {
  pollFailureAction,
  productionTransition,
  readingOrNull,
  shouldWriteTotal,
} from "../../lib/production";
import {
  CONNECTION_SETTING_KEYS,
  type DeviceData,
  type DeviceProtocol,
  type DeviceSettings,
  type OfflineBehavior,
  type SettingsInput,
} from "../../lib/types";

const RETRY_DELAY_MS = 5000;
const MAX_ATTEMPTS = 2;

const ADDED_IN_1_2_0 = ["measure_temperature", "meter_power.daily"];
const ADDED_IN_1_4_0 = ["measure_frequency"];
const OPTIONS_SYNCED_IN_1_2_0 = ["meter_power", "meter_power.daily"];

interface InverterClient {
  getData(): Promise<InverterData>;
}

interface DriverManifest {
  id: string;
  capabilitiesOptions?: Record<string, Record<string, unknown>>;
}

class OmnikLocal extends InverterDevice {
  private api?: InverterClient;
  private previousPower?: number;

  async onInit(): Promise<void> {
    this.log("[device] init");

    await this.migrateCapabilities();
    await this.migrateSettings();

    this.api = this.buildApi();

    return super.onInit();
  }

  /** Backfill settings for devices paired before v1.3, which only had the S/N in `data.id`. */
  private async migrateSettings(): Promise<void> {
    const settings = this.getSettings() as Partial<DeviceSettings>;
    const updates: Partial<DeviceSettings> = {};
    if (!settings.protocol) updates.protocol = "tcp";
    if (!settings.wifi_sn) updates.wifi_sn = String((this.getData() as DeviceData).id);
    if (!settings.offline_behavior) updates.offline_behavior = "keep_available";
    if (Object.keys(updates).length === 0) return;
    try {
      await this.setSettings(updates);
      this.log(`[migrate] backfilled settings: ${Object.keys(updates).join(", ")}`);
    } catch (err) {
      this.error("[migrate] failed to backfill settings", err);
    }
  }

  /**
   * `overrides` lets onSettings pass `newSettings`: Homey hasn't persisted them yet at that
   * point, so getSettings() still returns the old values.
   */
  private buildApi(overrides: Partial<DeviceSettings> = {}): InverterClient {
    const stored = this.getSettings() as Partial<DeviceSettings>;
    const settings = { ...stored, ...overrides } as DeviceSettings;
    const data = this.getData() as DeviceData;
    const protocol: DeviceProtocol = settings.protocol ?? "tcp";

    if (protocol === "http") {
      const auth = settings.http_user
        ? { user: settings.http_user, password: settings.http_password ?? "" }
        : undefined;
      this.log(`[device] using HTTP protocol${auth ? " with auth" : ""}`);
      return new OmnikHttpApi({ address: settings.ip, auth });
    }

    const wifiSn = settings.wifi_sn ? Number(settings.wifi_sn) : data.id;
    this.log(`[device] using TCP protocol (sn=${wifiSn})`);
    return new OmnikLocalApi({ address: settings.ip, wifiSn });
  }

  private async migrateCapabilities(): Promise<void> {
    for (const capability of [...ADDED_IN_1_2_0, ...ADDED_IN_1_4_0]) {
      if (this.hasCapability(capability)) continue;
      this.log(`[migrate] adding capability ${capability}`);
      await this.addCapability(capability).catch((err) =>
        this.error(`[migrate] failed to add ${capability}`, err),
      );
    }

    // capabilitiesOptions in driver.compose.json only apply to new pairings; push them to
    // upgraded devices so the v1.2 titles show up.
    const manifest = this.homey.manifest as { drivers?: DriverManifest[] } | undefined;
    const manifestOptions = manifest?.drivers?.find((d) => d.id === this.driver.id)
      ?.capabilitiesOptions;
    if (!manifestOptions) {
      this.log("[migrate] no capabilitiesOptions in driver manifest, skipping option sync");
      return;
    }

    for (const capability of OPTIONS_SYNCED_IN_1_2_0) {
      const opts = manifestOptions[capability];
      if (!opts) continue;
      try {
        await this.setCapabilityOptions(capability, opts);
      } catch (err) {
        this.error(`[migrate] failed to set options for ${capability}`, err);
      }
    }
  }

  async onSettings({ newSettings, changedKeys }: SettingsInput): Promise<void> {
    if (changedKeys.some((k) => (CONNECTION_SETTING_KEYS as readonly string[]).includes(k))) {
      this.api = this.buildApi(newSettings);
      this.log(`[settings] connection settings changed (${changedKeys.join(", ")}), rebuilt client`);
      // Poll right away so the user sees the effect of the change.
      this.checkProduction().catch((err) => this.error("[settings] immediate poll failed", err));
    }

    if (changedKeys.includes("interval") && newSettings.interval) {
      this.resetInterval(newSettings.interval);
      this.log(`[settings] interval changed to ${newSettings.interval} minutes`);
    }
  }

  async checkProduction(): Promise<void> {
    if (!this.api) {
      this.error("[poller] API not initialized");
      return;
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const data = await this.api.getData();
        this.log(
          `[poller] ${data.currentPower}W, ${data.currentVoltage}V, ${data.currentFrequency}Hz, today=${data.dailyProduction}kWh, total=${data.totalProduction}kWh, ${data.currentTemperature}°C`,
        );
        await this.applyInverterData(data);
        await this.markAvailable();
        return;
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt === MAX_ATTEMPTS) break;
        this.log(`[poller] attempt ${attempt} failed (${describeError(error)}), retrying in ${RETRY_DELAY_MS}ms`);
        await this.delay(RETRY_DELAY_MS);
      }
    }

    await this.handlePollFailure(lastError);
  }

  /**
   * Daily and lifetime totals stay untouched on failure: they must not regress just because
   * the inverter can't be reached. See lib/production.ts for the decision.
   */
  private async handlePollFailure(error: unknown): Promise<void> {
    const description = describeError(error);
    const behavior = this.getSetting("offline_behavior") as OfflineBehavior | undefined;

    if (pollFailureAction(behavior, this.getAvailable()) === "report_off") {
      this.log(`[poller] inverter unreachable (${description}); treating as off (power=0)`);
      await this.safeSetCapabilityValue("measure_power", 0);
      this.fireProductionTransitionTriggers(0);
      await this.safeSetCapabilityValue("measure_voltage", null);
      await this.safeSetCapabilityValue("measure_frequency", null);
      await this.safeSetCapabilityValue("measure_temperature", null);
      return;
    }

    this.error(`[poller] unavailable: ${description}`);
    await this.markUnavailable(`Error retrieving data: ${description}`);
  }

  // Availability only changes on transitions and never throws: SQLITE_FULL from
  // setUnavailable on every poll used to crash the app (crashes #4 and #6).
  private async markAvailable(): Promise<void> {
    if (this.getAvailable()) return;
    try {
      await this.setAvailable();
    } catch (err) {
      this.error("[device] setAvailable failed", err);
    }
  }

  private async markUnavailable(reason: string): Promise<void> {
    if (!this.getAvailable()) return;
    try {
      await this.setUnavailable(reason);
    } catch (err) {
      this.error("[device] setUnavailable failed", err);
    }
  }

  private async applyInverterData(data: InverterData): Promise<void> {
    await this.safeSetCapabilityValue("measure_power", data.currentPower);
    this.fireProductionTransitionTriggers(data.currentPower);

    await this.safeSetCapabilityValue("measure_voltage", readingOrNull(data.currentVoltage));
    await this.safeSetCapabilityValue("measure_frequency", readingOrNull(data.currentFrequency));
    await this.safeSetCapabilityValue("measure_temperature", readingOrNull(data.currentTemperature));

    if (Number.isFinite(data.dailyProduction)) {
      const previousDaily = this.getCapabilityValue("meter_power.daily") as number | null;
      await this.safeSetCapabilityValue("meter_power.daily", data.dailyProduction);
      if (previousDaily !== data.dailyProduction) {
        this.homey.flow
          .getDeviceTriggerCard("daily_production_changed")
          .trigger(this, { daily_production: data.dailyProduction })
          .catch((err) => this.error("[flow] failed to fire daily_production_changed", err));
      }
    }

    const previousTotal = this.getCapabilityValue("meter_power") as number | null;
    if (shouldWriteTotal(data.totalProduction, previousTotal)) {
      await this.safeSetCapabilityValue("meter_power", data.totalProduction);
    }
  }

  private fireProductionTransitionTriggers(currentPower: number): void {
    const transition = productionTransition(this.previousPower, currentPower);
    if (Number.isFinite(currentPower)) this.previousPower = currentPower;
    if (!transition) return;

    const cardId = transition === "started" ? "production_started" : "production_stopped";
    const tokens = transition === "started" ? { power: currentPower } : {};
    this.homey.flow
      .getDeviceTriggerCard(cardId)
      .trigger(this, tokens)
      .catch((err) => this.error(`[flow] failed to fire ${cardId}`, err));
  }

  private async safeSetCapabilityValue(capability: string, value: number | null): Promise<void> {
    if (!this.hasCapability(capability)) return;
    try {
      await this.setCapabilityValue(capability, value);
    } catch (err) {
      this.error(`[device] failed to set ${capability} = ${value}`, err);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => this.homey.setTimeout(resolve, ms));
  }
}

module.exports = OmnikLocal;
