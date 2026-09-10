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
}

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
  /** Whether this build has an engine at all, so a screen can say so instead
   *  of throwing at the first tap. */
  available: Boolean(native),
};
