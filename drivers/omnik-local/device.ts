"use strict";

import { Inverter } from "../../inverter";
import OmnikLocalApi, {
  HostUnreachableError,
  InverterData,
  ParseError,
  TimeoutError,
  UnauthorizedError,
  UnexpectedResponseError,
} from "./api";
import { OmnikHttpApi, HttpAuth } from "./http-api";
import { DeviceData, DeviceProtocol, DeviceSettings, SettingsInput } from "./types";

const RETRY_DELAY_MS = 5000;
const MAX_ATTEMPTS = 2;

const MIGRATED_OPTIONS = ["meter_power", "meter_power.daily"];

interface InverterClient {
  getData(): Promise<InverterData>;
}

class OmnikLocal extends Inverter {
  private api?: InverterClient;
  private previousPower?: number;

  async onInit(): Promise<void> {
    this.log("Device has been initialized");

    await this.migrateCapabilities();
    await this.migrateSettings();

    this.api = this.buildApi();

    return super.onInit();
  }

  /**
   * Backfill settings introduced in v1.3 for devices paired with v1.1 or v1.2.
   * These devices have the wifi-stick S/N in `data.id` but no `wifi_sn` /
   * `protocol` setting yet. Without this, the settings UI would show empty
   * fields and `buildApi()` would have to fall back to data.id.
   */
  private async migrateSettings(): Promise<void> {
    const settings = this.getSettings() as Partial<DeviceSettings>;
    const updates: Partial<DeviceSettings> = {};
    if (!settings.protocol) updates.protocol = "tcp";
    if (!settings.wifi_sn) updates.wifi_sn = String(this.getData().id);
    if (!settings.offline_behavior) updates.offline_behavior = "keep_available";
    if (Object.keys(updates).length === 0) return;
    try {
      await this.setSettings(updates);
      this.log(`Backfilled settings: ${Object.keys(updates).join(", ")}`);
    } catch (err) {
      this.error("Failed to backfill v1.3 settings", err);
    }
  }

  /**
   * Build the API client. Accepts an optional `overrides` object so callers in
   * `onSettings` can pass `newSettings` directly — at that point Homey has not
   * yet persisted the new values, so `getSettings()` still returns the old
   * ones. Using the explicit overrides makes a setting change take effect at
   * the very next `checkProduction()` instead of after the next `onInit()`.
   */
  private buildApi(overrides: Partial<DeviceSettings> = {}): InverterClient {
    const stored = this.getSettings() as Partial<DeviceSettings>;
    const settings = { ...stored, ...overrides } as DeviceSettings;
    const data: DeviceData = this.getData();
    const protocol: DeviceProtocol = settings.protocol ?? "tcp";

    if (protocol === "http") {
      const auth = settings.http_user
        ? { user: settings.http_user, password: settings.http_password ?? "" }
        : undefined;
      this.log(`Using HTTP protocol${auth ? " with auth" : ""}`);
      return new OmnikHttpApi({ address: settings.ip, auth });
    }

    const wifiSn = settings.wifi_sn ? Number(settings.wifi_sn) : data.id;
    this.log(`Using TCP protocol (sn=${wifiSn})`);
    return new OmnikLocalApi({ address: settings.ip, wifiSn });
  }

  private async migrateCapabilities(): Promise<void> {
    if (!this.hasCapability("measure_temperature")) {
      this.log("Adding capability measure_temperature");
      await this.addCapability("measure_temperature");
    }
    if (!this.hasCapability("meter_power.daily")) {
      this.log("Adding capability meter_power.daily");
      await this.addCapability("meter_power.daily");
    }
    if (!this.hasCapability("measure_frequency")) {
      this.log("Adding capability measure_frequency");
      await this.addCapability("measure_frequency");
    }

    // capabilitiesOptions in driver.compose.json only apply to fresh pairings.
    // For upgrades we have to re-push them so v1.2 titles take effect on
    // existing devices. Read from the homey manifest (works regardless of
    // whether `driver.manifest` is populated in this SDK version).
    const driverId = this.driver.id;
    const driverManifest = (this.homey.manifest as any)?.drivers?.find(
      (d: any) => d.id === driverId
    );
    const manifestOptions: Record<string, Record<string, unknown>> | undefined =
      driverManifest?.capabilitiesOptions;

    if (!manifestOptions) {
      this.log("No capabilitiesOptions found in driver manifest, skipping option sync");
      return;
    }

    for (const capability of MIGRATED_OPTIONS) {
      const opts = manifestOptions[capability];
      if (!opts) continue;
      try {
        await this.setCapabilityOptions(capability, opts);
        this.log(`Synced options for ${capability}`);
      } catch (err) {
        this.error(`Failed to set options for ${capability}`, err);
      }
    }
  }

  async onSettings({ newSettings, changedKeys }: SettingsInput) {
    // Any change in connection-related settings means we have to rebuild the
    // client. `newSettings` is passed through to buildApi because the new
    // values aren't necessarily persisted yet at this point.
    const connectionKeys = ["ip", "protocol", "wifi_sn", "http_user", "http_password"];
    if (changedKeys.some((k) => connectionKeys.includes(k))) {
      this.api = this.buildApi(newSettings);
      this.log(`Connection settings changed (${changedKeys.join(", ")}), rebuilt API client`);
      // Trigger an immediate fetch so the user sees the effect of their change.
      this.checkProduction();
    }

    if (changedKeys.includes("interval") && newSettings.interval) {
      this.resetInterval(newSettings.interval);
      this.log(`Changed interval to ${newSettings.interval} minutes`);
    }
  }

  async checkProduction(): Promise<void> {
    if (!this.api) {
      this.error("API not initialized");
      return;
    }

    this.log("Checking production");

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const data = await this.api.getData();
        this.log(
          `Inverter response: ${data.currentPower}W, ${data.currentVoltage}V, ${data.currentFrequency}Hz, today=${data.dailyProduction}kWh, total=${data.totalProduction}kWh, ${data.currentTemperature}°C`
        );
        await this.applyInverterData(data);
        await this.markAvailable();
        return;
      } catch (error) {
        lastError = error;
        if (!this.isRetryable(error) || attempt === MAX_ATTEMPTS) break;
        this.log(`Attempt ${attempt} failed (${this.describe(error)}), retrying in ${RETRY_DELAY_MS}ms`);
        await this.delay(RETRY_DELAY_MS);
      }
    }

    await this.handlePollFailure(lastError);
  }

  /**
   * Decide what to do when polling has exhausted its retries.
   *
   * With `offline_behavior = keep_available` (default) we assume the inverter
   * has simply shut down because there's no DC voltage — typical at night for
   * solar inverters whose WiFi module loses power along with them. Keep the
   * device available and set measure_power to 0 so:
   *   - Insights graphs land cleanly at 0 W instead of leaving a stale value
   *   - production_stopped Flow card fires (via fireProductionTransitionTriggers)
   *   - Homey's notification feed isn't spammed every evening
   * meter_power and meter_power.daily are left untouched (lifetime + daily
   * totals must not regress to 0 just because we couldn't reach the inverter).
   *
   * If the device was *already* unavailable we don't flip it back to available
   * on a failure — only a successful poll does that. And `mark_unavailable`
   * preserves the legacy behavior for users who want the explicit signal.
   */
  private async handlePollFailure(error: unknown): Promise<void> {
    const description = this.describe(error);
    const offlineBehavior = (this.getSetting("offline_behavior") as
      | "keep_available"
      | "mark_unavailable"
      | undefined) ?? "keep_available";

    if (offlineBehavior === "keep_available" && this.getAvailable()) {
      this.log(`Inverter unreachable (${description}); treating as off (power=0)`);
      await this.safeSetCapabilityValue("measure_power", 0);
      this.fireProductionTransitionTriggers(0);
      await this.safeSetCapabilityValue("measure_voltage", null);
      await this.safeSetCapabilityValue("measure_frequency", null);
      await this.safeSetCapabilityValue("measure_temperature", null);
      return;
    }

    this.error(`Unavailable: ${description}`);
    await this.markUnavailable(`Error retrieving data: ${description}`);
  }

  /**
   * Wrappers around setAvailable/setUnavailable that:
   *   - only call when the state actually changes (avoids hammering the
   *     internal SQLite DB every polling cycle when the inverter stays offline)
   *   - swallow errors so a transient DB-full / SDK error doesn't crash the
   *     whole app process. Crashes #4 and #6 (340× SQLITE_FULL) bubbled out of
   *     setUnavailable as unhandled rejections; this is the safety net.
   */
  private async markAvailable(): Promise<void> {
    if (this.getAvailable()) return;
    try {
      await this.setAvailable();
    } catch (err) {
      this.error("setAvailable failed", err);
    }
  }

  private async markUnavailable(reason: string): Promise<void> {
    if (!this.getAvailable()) return;
    try {
      await this.setUnavailable(reason);
    } catch (err) {
      this.error("setUnavailable failed", err);
    }
  }

  private async applyInverterData(data: InverterData): Promise<void> {
    await this.safeSetCapabilityValue("measure_power", data.currentPower);
    this.fireProductionTransitionTriggers(data.currentPower);

    // Voltage, frequency and temperature are not available over HTTP, and TCP
    // can return sentinel 0xFFFF when a sensor is unavailable. Write null in
    // those cases so the UI shows "—" instead of leaving a stale reading on
    // screen.
    await this.safeSetCapabilityValue(
      "measure_voltage",
      Number.isFinite(data.currentVoltage) ? data.currentVoltage : null
    );
    await this.safeSetCapabilityValue(
      "measure_frequency",
      Number.isFinite(data.currentFrequency) ? data.currentFrequency : null
    );
    await this.safeSetCapabilityValue(
      "measure_temperature",
      Number.isFinite(data.currentTemperature) ? data.currentTemperature : null
    );

    if (Number.isFinite(data.dailyProduction)) {
      const previousDaily = this.getCapabilityValue("meter_power.daily") as number | null;
      await this.safeSetCapabilityValue("meter_power.daily", data.dailyProduction);
      if (previousDaily !== data.dailyProduction) {
        this.driver
          .homey.flow.getDeviceTriggerCard("daily_production_changed")
          .trigger(this, { daily_production: data.dailyProduction })
          .catch((err) => this.error("Failed to fire daily_production_changed", err));
      }
    }

    // meter_power tracks lifetime cumulative kWh (from protocol offset 71).
    // Never null this out — Insights treats null as a regression that breaks
    // monthly aggregations. Skip writes when we can't trust the reading.
    if (Number.isFinite(data.totalProduction)) {
      const previousTotal = this.getCapabilityValue("meter_power") as number | null;
      if (data.totalProduction > 0 || previousTotal == null) {
        await this.safeSetCapabilityValue("meter_power", data.totalProduction);
      }
    }
  }

  /**
   * Fire production_started / production_stopped triggers on the 0 ↔ >0
   * transition of measure_power. Only fires from the second poll onwards
   * (need a previous value to compare against), and ignores non-finite
   * readings — those would create spurious transitions.
   */
  private fireProductionTransitionTriggers(currentPower: number): void {
    if (!Number.isFinite(currentPower)) return;
    const previous = this.previousPower;
    this.previousPower = currentPower;
    if (previous === undefined || !Number.isFinite(previous)) return;

    const wasProducing = previous > 0;
    const isProducing = currentPower > 0;
    if (wasProducing === isProducing) return;

    const cardId = isProducing ? "production_started" : "production_stopped";
    const tokens = isProducing ? { power: currentPower } : {};
    this.driver
      .homey.flow.getDeviceTriggerCard(cardId)
      .trigger(this, tokens)
      .catch((err) => this.error(`Failed to fire ${cardId}`, err));
  }

  private async safeSetCapabilityValue(capability: string, value: unknown): Promise<void> {
    try {
      await this.setCapabilityValue(capability, value);
    } catch (err) {
      this.error(`Failed to set ${capability} = ${value}`, err);
    }
  }

  private isRetryable(error: unknown): boolean {
    return (
      error instanceof TimeoutError ||
      error instanceof HostUnreachableError ||
      (error instanceof Error && /ECONNRESET|EPIPE|ETIMEDOUT/.test(error.message))
    );
  }

  private describe(error: unknown): string {
    if (error instanceof TimeoutError) return "timeout";
    if (error instanceof HostUnreachableError) return error.message;
    if (error instanceof UnauthorizedError) return error.message;
    if (error instanceof UnexpectedResponseError) return error.message;
    if (error instanceof ParseError) return error.message;
    if (error instanceof Error) return error.message;
    return String(error);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => this.homey.setTimeout(resolve, ms));
  }
}

module.exports = OmnikLocal;
