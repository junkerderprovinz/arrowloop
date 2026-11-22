import { DEFAULT_ACCENT, contrastOn, resolveAccent } from "../../web/src/lib/appearance.ts";
import type { Appearance } from "./settings";

// What StartJobActivity needs to draw the app's look without React Native. It
// cannot read AsyncStorage, so the screens hand it over through the engine
// module whenever the appearance changes.

export interface Tone {
  accent: string;
  /** The text on the accent. */
  ink: string;
}

export interface PluginLook {
  theme: Appearance["theme"];
  oled: boolean;
  lock: boolean;
  /** The card radius in dp. */
  radius: number;
  leaf: boolean;
  /** Both looks, since the picker follows the phone when the theme is the system's. */
  light: Tone;
  dark: Tone;
}

export function pluginLook(
  a: Pick<Appearance, "theme" | "oled" | "accent" | "lock" | "shape">,
  system: { light: string; dark: string } | undefined,
  radius: number,
): PluginLook {
  const tone = (scheme: "light" | "dark"): Tone => {
    const accent = resolveAccent(a.accent, system?.[scheme]) ?? DEFAULT_ACCENT;
    return { accent, ink: contrastOn(accent) };
  };
  return {
    theme: a.theme,
    oled: a.oled,
    lock: a.lock,
    radius,
    leaf: a.shape === "leaf",
    light: tone("light"),
    dark: tone("dark"),
  };
}
