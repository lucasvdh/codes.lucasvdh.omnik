export type DeviceProtocol = "tcp" | "http";

/**
 * Behavior when the inverter cannot be reached during polling.
 *   keep_available — assume the inverter has shut down (typical at night when
 *     the WiFi module loses power along with it); keep the device available
 *     and set measure_power to 0. The Insights graph and Flow cards see a
 *     clean shutdown instead of an availability blip.
 *   mark_unavailable — legacy behavior. The device is marked unavailable
 *     and surfaces in Homey's notification feed every time polling fails.
 */
export type OfflineBehavior = "keep_available" | "mark_unavailable";

export interface DeviceData {
  /**
   * Homey's immutable device identity. We use the WiFi-stick S/N as a number
   * (parsed from m2mMid). For HTTP-only setups it's still the m2mMid value
   * — it just isn't sent over the wire.
   */
  id: number;
}

export interface DeviceSettings {
  ip: string;
  interval: number;
  protocol: DeviceProtocol;
  wifi_sn: string;
  http_user: string;
  http_password: string;
  offline_behavior: OfflineBehavior;
}

/** Partial of DeviceSettings — Homey passes only the changed keys' values. */
export type NewSettings = Partial<DeviceSettings>;

export interface SettingsInput {
  newSettings: NewSettings;
  changedKeys: Array<string>;
}

export interface Device {
  name: string;
  data: DeviceData;
  settings: DeviceSettings;
}
