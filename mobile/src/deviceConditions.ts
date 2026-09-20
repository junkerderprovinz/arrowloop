import type { TranslationKey } from "../../web/src/lib/i18n.data";
import type { DevicePolicy } from "./engine";

/**
 * Returns the translation key for the condition holding automatic runs.
 * `policy.holding` is the engine's English log sentence, so screens use this
 * instead. The order matches Device.kt, which holds on the first reason it
 * finds.
 */
export function heldKey(policy: DevicePolicy | null): TranslationKey | null {
  if (!policy) return null;
  if (policy.onlyCharging && !policy.charging) return "phone.heldCharging";
  // The battery floor applies only off the charger, as in Device.kt.
  if (policy.minBattery > 0 && !policy.charging && policy.battery >= 0 && policy.battery < policy.minBattery) {
    return "phone.heldBattery";
  }
  if (policy.onlyWifi && !policy.onWifi) return "phone.heldWifi";
  if (policy.notRoaming && policy.roaming) return "phone.heldRoaming";
  if (policy.notMetered && policy.metered) return "phone.heldMetered";
  return null;
}
