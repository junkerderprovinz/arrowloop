import { NativeModules, Platform } from "react-native";

/**
 * The engine PROCESS, as opposed to the engine's API.
 *
 * Two different things and it is worth keeping them apart: `api.ts` talks to a
 * running engine over HTTP, this starts and stops the process that answers.
 * Everything here crosses into Kotlin, because none of it is expressible in
 * JavaScript - executing a binary out of the native library directory, holding
 * a foreground service, asking for a permission Android grants on a settings
 * page.
 *
 * The Kotlin behind it is the code the WebView shell already used, moved
 * behind a module rather than rewritten: `Engine.kt`, `EngineService.kt` and
 * `Storage.kt` keep every comment explaining why they are the way they are -
 * the exec-from-nativeLibraryDir rule, the dataSync caps, the whole SAF
 * finding.
 */

interface EngineNativeModule {
  /** Start the foreground service, which starts the engine. Idempotent. */
  start(): Promise<void>;
  /** Stop the service and the engine with it. */
  stop(): Promise<void>;
  /** The engine's own log for this run, newest last. */
  log(): Promise<string>;
  /** Whether the process we started is still alive - which an empty log
   *  cannot say, since "died before writing" and "running and quiet" look
   *  identical from the outside. */
  alive(): Promise<boolean>;
  /** Whether the app may read and write the phone's files. */
  storageGranted(): Promise<boolean>;
  /** Whether this Android version can grant that at all. Android 10 cannot:
   *  MANAGE_EXTERNAL_STORAGE arrived in 11, and requestLegacyExternalStorage
   *  is ignored for an app targeting above 29. */
  storagePossible(): Promise<boolean>;
  /** Open the settings page that grants it. There is no dialog for this
   *  permission - Google routed the broadest file access there is through a
   *  full settings page rather than a two-button prompt. */
  openStorageSettings(): Promise<void>;
  /** This app's own settings page, where a refused permission can be changed.
   *  The request dialog is a one-shot and shows nothing after a no. */
  openAppSettings(): Promise<void>;
  /** Android's own notification settings for this app: sound, vibration,
   *  banners, Do Not Disturb, the per-channel switches. All of it is Android's
   *  to own, so this links there rather than rebuilding it. */
  openNotificationSettings(): Promise<void>;
  /** The battery-optimisation list, where an OEM's power manager keeps the
   *  setting that decides whether a background job ever runs. */
  openBatterySettings(): Promise<void>;
  /** Write a settings backup into the public Downloads folder, and hand back
   *  where it landed. */
  exportSettings(json: string): Promise<string>;
  /** Read one back. An empty path means the default place. */
  importSettings(path: string): Promise<string>;
  /** Where a backup goes, before one has ever been written. */
  backupPath(): Promise<string>;
  /** Whether this phone has a real screen lock, as opposed to a swipe. */
  hasDeviceLock(): Promise<boolean>;
  /** Ask for the phone's own lock. True when it was given. */
  confirmDeviceLock(title: string, detail: string): Promise<boolean>;

  /** Both schedule conditions and the facts behind them, in one answer: what
   *  was asked for, what the phone is actually plugged into, and the sentence
   *  that is holding automatic runs back right now if one is. */
  devicePolicy(): Promise<DevicePolicy>;
  /** Store the two conditions and tell the engine at once. */
  setDevicePolicy(onlyCharging: boolean, onlyWifi: boolean): Promise<void>;
  /** Whether the engine is UP and answering, as opposed to whether this app's
   *  own handle to it is still alive. The card that says "the engine is
   *  running" wants this one. */
  answering(): Promise<boolean>;
  /** Whether Android has agreed to leave the app alone in the background. */
  batteryExempt(): Promise<boolean>;
  /** Ask for that, which really is one dialog with one button. */
  askBatteryExemption(): Promise<void>;
  /** Put a string on the system clipboard. Here rather than through a library
   *  because the app already owns a native module and this is four lines of it:
   *  React Native's own Clipboard is deprecated and warns on every use, and a
   *  second autolinked package for one call is a build dependency to keep
   *  current forever. */
  copy(value: string): Promise<void>;
}

export interface DevicePolicy {
  onlyCharging: boolean;
  onlyWifi: boolean;
  charging: boolean;
  /** Whether this phone is on wifi or a cable, as opposed to mobile data. */
  onWifi: boolean;
  /** Empty unless something is holding automatic runs back. */
  holding: string;
}

const NOTHING_HELD: DevicePolicy = {
  onlyCharging: false,
  onlyWifi: false,
  charging: true,
  onWifi: true,
  holding: "",
};

const native = NativeModules.ArrowLoopEngine as EngineNativeModule | undefined;

/**
 * A stand-in for anywhere the native module is absent.
 *
 * That is `expo start` on a laptop and the web target, where there is no
 * engine to supervise. It REFUSES rather than pretending: a stub that resolved
 * happily would make a development build look like it had started an engine
 * that does not exist, and the screens would then wait sixty seconds for
 * nothing.
 */
function missing(): never {
  throw new Error(
    Platform.OS === "android"
      ? "the engine module is missing from this build"
      : `there is no engine on ${Platform.OS} - ArrowLoop's engine is Android-only`,
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
  openNotificationSettings: () => (native ? native.openNotificationSettings() : missing()),
  openBatterySettings: () => (native ? native.openBatterySettings() : missing()),
  exportSettings: (json: string) => (native ? native.exportSettings(json) : missing()),
  importSettings: (path: string) => (native ? native.importSettings(path) : missing()),
  backupPath: () => (native ? native.backupPath() : missing()),
  hasDeviceLock: () => (native ? native.hasDeviceLock() : Promise.resolve(false)),
  confirmDeviceLock: (title: string, detail: string) =>
    native ? native.confirmDeviceLock(title, detail) : missing(),
  devicePolicy: () => (native ? native.devicePolicy() : Promise.resolve(NOTHING_HELD)),
  setDevicePolicy: (onlyCharging: boolean, onlyWifi: boolean) =>
    native ? native.setDevicePolicy(onlyCharging, onlyWifi) : missing(),
  batteryExempt: () => (native ? native.batteryExempt() : Promise.resolve(true)),
  askBatteryExemption: () => (native ? native.askBatteryExemption() : missing()),
  copy: (value: string) => (native ? native.copy(value) : missing()),
  /** Whether this build has an engine at all, so a screen can say so instead
   *  of throwing at the first tap. */
  available: Boolean(native),
};
