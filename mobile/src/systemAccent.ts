import { useSyncExternalStore } from "react";
import { AppState, DeviceEventEmitter } from "react-native";

import { argbToHex } from "../../web/src/lib/colorMath";
import { engine, type AccentTones } from "./engine";
import type { Scheme } from "./theme";

// Material You's colour, the source of the wand swatch on the phone. Android
// 12 and newer build a palette from the wallpaper, which EngineModule reads.
// Below 12 there is no palette, no swatch, and an accent set to the system's
// colour shows the default.

/** The event EngineModule sends when the palette changes, ACCENT_EVENT there. */
const ACCENT_EVENT = "systemAccentChanged";

let tones: { light: string; dark: string } | undefined;
const listeners = new Set<() => void>();

function take(got: AccentTones | null) {
  const next = got ? { light: argbToHex(got.light), dark: argbToHex(got.dark) } : undefined;
  if (next?.light === tones?.light && next?.dark === tones?.dark) return;
  tones = next;
  listeners.forEach((fn) => fn());
}

function read() {
  engine.systemAccent().then(take, () => {});
}

/**
 * Reads the palette now, again whenever the app comes back to the front, and
 * whenever Android reports a new one while it is in front. Returns the
 * function that stops.
 */
export function watchSystemAccent(): () => void {
  read();
  const back = AppState.addEventListener("change", (state) => {
    if (state === "active") read();
  });
  const changed = DeviceEventEmitter.addListener(ACCENT_EVENT, (got: AccentTones | null) => take(got));
  return () => {
    back.remove();
    changed.remove();
  };
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The system's colour for the look that shows, as Material 3 takes its
 * primary for it, or undefined where the phone has none.
 */
export function useSystemAccent(scheme: Scheme): string | undefined {
  const now = useSyncExternalStore(subscribe, () => tones);
  return now?.[scheme];
}
