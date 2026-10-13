import { NativeModules, Platform } from "react-native";

// Starts and stops the engine process through the native module; api.ts talks
// to the running engine over HTTP.

interface EngineNativeModule {
  /** Starts the foreground service, which starts the engine. Idempotent. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** The engine's log for this run, newest last. */
  log(): Promise<string>;
  /** Whether the started process is alive, which an empty log cannot tell. */
  alive(): Promise<boolean>;
  storageGranted(): Promise<boolean>;
  /** False on Android 10, which cannot grant full file access. */
  storagePossible(): Promise<boolean>;
  /** Opens the settings page that grants file access; there is no dialog for it. */
  openStorageSettings(): Promise<void>;
  /** Opens the app's settings, where a refused permission can be changed. */
  openAppSettings(): Promise<void>;
  openNotificationSettings(): Promise<void>;
  /** Opens the battery optimisation list, where OEMs decide whether background jobs run. */
  openBatterySettings(): Promise<void>;
  /** Writes a settings backup to Downloads and returns its path. */
  exportSettings(json: string): Promise<string>;
  /** Reads a backup; an empty path means the default place. */
  importSettings(path: string): Promise<string>;
  backupPath(): Promise<string>;
  /** Whether the phone has a real screen lock rather than a swipe. */
  hasDeviceLock(): Promise<boolean>;
  /** Asks for the phone's lock and resolves true when it was given. */
  confirmDeviceLock(title: string, detail: string): Promise<boolean>;

  devicePolicy(): Promise<DevicePolicy>;
  /** Stores the given conditions and tells the engine; omitted ones keep their value. */
  setDevicePolicy(policy: Partial<DeviceConditions>): Promise<void>;
  /** Whether the engine answers over HTTP, not merely whether its process lives. */
  answering(): Promise<boolean>;
  /** The secret every request to the engine carries, so no other app can drive it. */
  token(): Promise<string>;
  batteryExempt(): Promise<boolean>;
  /** Copies to the clipboard; React Native's own Clipboard is deprecated. */
  copy(value: string): Promise<void>;

  /** How Android/data stands, after starting its server if it is switched on. */
  appData(): Promise<AppData>;
  /** Switches Android/data on or off and starts the engine over. */
  setAppData(on: boolean): Promise<AppData>;
  /** Keeps to the given way and starts the server and the engine over. */
  setAppDataWay(way: AppDataWay): Promise<AppData>;
  /** Stores what runs as su, asks it for root again and starts over. */
  setAppDataSu(su: string): Promise<AppData>;
  /** Runs su again, so the root manager shows its prompt. */
  requestRoot(): Promise<AppData>;
  /** Shows Shizuku's permission dialog and resolves once it is answered. */
  askShizuku(): Promise<AppData>;
}

/**
 * Whether the engine can reach Android/data, and if not, why. Anything but
 * `off` means the switch is on.
 */
export type AppDataState =
  | "off"
  /** Through su: read and write. */
  | "root"
  /** Through Shizuku as the adb shell user: read only. */
  | "shizuku"
  /** Neither root nor Shizuku on this phone. */
  | "noWay"
  /** Nothing runs under the name set for su. */
  | "noSu"
  /** su runs but has not given root. */
  | "rootDenied"
  | "noShizuku"
  | "shizukuStopped"
  | "shizukuDenied"
  /** The server stopped twice. */
  | "failed";

export type AppDataWay = "root" | "shizuku";

export interface AppData {
  state: AppDataState;
  /** The way picked, or while none is, the way last tried. */
  way: AppDataWay;
  /** False once su was found missing, which leaves root out. */
  root: boolean;
  /** Whether Shizuku is installed or running. */
  shizuku: boolean;
  /** What runs as su: a command name or a path. */
  su: string;
}

/**
 * The run conditions somebody chose. Kept apart from the live readings in
 * DevicePolicy, since only these may be written.
 */
export interface DeviceConditions {
  onlyCharging: boolean;
  onlyWifi: boolean;
  /** Percent, 0 to 95. Zero is off. */
  minBattery: number;
  notRoaming: boolean;
  /** About cost rather than transport: a wifi network can be metered. */
  notMetered: boolean;
}

export interface DevicePolicy extends DeviceConditions {
  charging: boolean;
  /** On wifi or a cable, as opposed to mobile data. */
  onWifi: boolean;
  /** 0 to 100, or -1 before the first reading. */
  battery: number;
  roaming: boolean;
  metered: boolean;
  /** Empty unless something is holding automatic runs back. */
  holding: string;
}

/** What a build without the native module reports: nothing held. */
const NOTHING_HELD: DevicePolicy = {
  onlyCharging: false,
  onlyWifi: false,
  minBattery: 0,
  notRoaming: false,
  notMetered: false,
  charging: true,
  onWifi: true,
  battery: 100,
  roaming: false,
  metered: false,
  holding: "",
};

/** What a build without the native module reports: switched off. */
const NO_APP_DATA: AppData = { state: "off", way: "root", root: true, shizuku: false, su: "su" };

const native = NativeModules.ArrowLoopEngine as EngineNativeModule | undefined;

/**
 * Throws where the native module is absent (`expo start`, the web target), so
 * a development build never looks as if it started an engine.
 */
function missing(): never {
  throw new Error(
    Platform.OS === "android"
      ? "the engine module is missing from this build"
      : `there is no engine on ${Platform.OS}; ArrowLoop's engine is Android-only`,
  );
}

export const engine = {
  start: () => (native ? native.start() : missing()),
  stop: () => (native ? native.stop() : missing()),
  log: () => (native ? native.log() : Promise.resolve("")),
  alive: () => (native ? native.alive() : Promise.resolve(false)),
  storageGranted: () => (native ? native.storageGranted() : Promise.resolve(false)),
  storagePossible: () => (native ? native.storagePossible() : Promise.resolve(false)),
  openStorageSettings: () => (native ? native.openStorageSettings() : missing()),
  openAppSettings: () => (native ? native.openAppSettings() : missing()),
  answering: () => (native ? native.answering() : Promise.resolve(false)),
  token: () => (native ? native.token() : Promise.resolve("")),
  openNotificationSettings: () => (native ? native.openNotificationSettings() : missing()),
  openBatterySettings: () => (native ? native.openBatterySettings() : missing()),
  exportSettings: (json: string) => (native ? native.exportSettings(json) : missing()),
  importSettings: (path: string) => (native ? native.importSettings(path) : missing()),
  backupPath: () => (native ? native.backupPath() : missing()),
  hasDeviceLock: () => (native ? native.hasDeviceLock() : Promise.resolve(false)),
  confirmDeviceLock: (title: string, detail: string) =>
    native ? native.confirmDeviceLock(title, detail) : missing(),
  devicePolicy: () => (native ? native.devicePolicy() : Promise.resolve(NOTHING_HELD)),
  setDevicePolicy: (policy: Partial<DeviceConditions>) =>
    native ? native.setDevicePolicy(policy) : missing(),
  batteryExempt: () => (native ? native.batteryExempt() : Promise.resolve(true)),
  copy: (value: string) => (native ? native.copy(value) : missing()),
  appData: (): Promise<AppData> => (native ? native.appData() : Promise.resolve(NO_APP_DATA)),
  setAppData: (on: boolean) => (native ? native.setAppData(on) : missing()),
  setAppDataWay: (way: AppDataWay) => (native ? native.setAppDataWay(way) : missing()),
  setAppDataSu: (su: string) => (native ? native.setAppDataSu(su) : missing()),
  requestRoot: () => (native ? native.requestRoot() : missing()),
  askShizuku: () => (native ? native.askShizuku() : missing()),
  /** Whether this build has an engine at all. */
  available: Boolean(native),
};
