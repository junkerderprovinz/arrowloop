import type { TranslationKey } from "../../web/src/lib/i18n.data";
import type { DevicePolicy } from "./engine";

/**
 * Which condition is holding automatic runs, as a TRANSLATION KEY.
 *
 * The engine is told a sentence, in English, because that sentence goes into a
 * log somebody reads next to every other line the engine wrote. A screen that
 * repeated it would be showing English to somebody reading German, which is
 * exactly what the sync page was doing: it printed `policy.holding` straight
 * out of Kotlin while the settings page beside it re-derived the same fact in
 * the app's own words.
 *
 * So this is the one place that decides, and it returns a key rather than a
 * sentence: the module has no business importing the translation tables, and a
 * key can be checked by the orphan guard.
 *
 * The order matches Device.kt's, and it has to: the engine holds on the FIRST
 * reason it finds, so a screen listing a different one would name a condition
 * that is not the one in the log.
 */
export function heldKey(policy: DevicePolicy | null): TranslationKey | null {
  if (!policy) return null;
  if (policy.onlyCharging && !policy.charging) return "phone.heldCharging";
  // Only while off the cable, the same way Device.kt asks it. A phone at ten
  // percent ON the charger is climbing, and a screen saying it is being held
  // would be describing a rule that is not being applied.
  if (policy.minBattery > 0 && !policy.charging && policy.battery >= 0 && policy.battery < policy.minBattery) {
    return "phone.heldBattery";
  }
  if (policy.onlyWifi && !policy.onWifi) return "phone.heldWifi";
  if (policy.notRoaming && policy.roaming) return "phone.heldRoaming";
  if (policy.notMetered && policy.metered) return "phone.heldMetered";
  return null;
}
