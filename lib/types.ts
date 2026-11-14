export type DeviceProtocol = "tcp" | "http";

/** What an unreachable inverter means; see pollFailureAction in production.ts. */
export type OfflineBehavior = "keep_available" | "mark_unavailable";

export interface DeviceData {
  /** WiFi module S/N (m2mMid) as a number; the device identity, never changes. */
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

export type NewSettings = Partial<DeviceSettings>;

export interface SettingsInput {
  newSettings: NewSettings;
  changedKeys: Array<string>;
}

export interface Device {
  name: string;
  data: DeviceData;
  store: Record<string, string>;
  settings: DeviceSettings;
}

/** Settings that change how the app connects; changing one rebuilds the client. */
export const CONNECTION_SETTING_KEYS = [
  "ip",
  "protocol",
  "wifi_sn",
  "http_user",
  "http_password",
] as const satisfies ReadonlyArray<keyof DeviceSettings>;
