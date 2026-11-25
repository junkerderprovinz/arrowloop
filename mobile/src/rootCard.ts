import type { TranslationKey } from "./i18n";

/** What su answered when last asked for root, or "unknown" before it was asked. */
export type RootAnswer = "granted" | "denied" | "absent" | "unknown";

/** Whether Shizuku runs and lets ArrowLoop in. */
export type ShizukuState = "ready" | "denied" | "stopped" | "missing";

type Access = { rootAnswer: RootAnswer; shizukuState: ShizukuState };

/** The buttons the Root card offers for getting at root and Shizuku. */
export function rootActions({ rootAnswer, shizukuState }: Access) {
  return {
    requestRoot: rootAnswer !== "granted",
    askShizuku: shizukuState === "denied",
    getShizuku: shizukuState === "missing",
  };
}

export function rootStatus(answer: RootAnswer): TranslationKey {
  switch (answer) {
    case "granted":
      return "phone.rootGranted";
    case "denied":
      return "phone.rootRefused";
    case "absent":
      return "phone.rootMissing";
    case "unknown":
      return "phone.rootUnasked";
  }
}

export function shizukuStatus(state: ShizukuState): TranslationKey {
  switch (state) {
    case "ready":
      return "phone.shizukuReady";
    case "denied":
      return "phone.shizukuWaiting";
    case "stopped":
      return "phone.shizukuStopped";
    case "missing":
      return "phone.shizukuMissing";
  }
}

/**
 * Why each switch of the card is dimmed, or null where it can be used. A
 * switch that is on stays usable, so it can always be switched off.
 */
export function switchesHeld({
  rootAnswer,
  shizukuState,
  appDataOn,
  rootTargetOn,
}: Access & { appDataOn: boolean; rootTargetOn: boolean }): {
  appData: TranslationKey | null;
  rootTarget: TranslationKey | null;
} {
  const root = rootAnswer === "granted";
  return {
    appData: appDataOn || root || shizukuState === "ready" ? null : "phone.appDataNeedsAccess",
    rootTarget: rootTargetOn || root ? null : "phone.rootTargetNeedsRoot",
  };
}
