import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { ORIGIN } from "./api";

// Appearance belongs to the phone and lives in AsyncStorage. Behaviour, such
// as the language and the run conditions, belongs to the engine and goes
// through its settings API, which merges rather than replaces.

/**
 * How much of a control's label is shown. `reactive` shows words under the
 * pointer and makes no sense on a touch screen; it is accepted only because
 * older settings files may carry it.
 */
export type LabelMode = "text" | "textGlyph" | "glyph" | "reactive";

/** The label modes the picker offers. */
export const LABEL_MODES = ["text", "textGlyph", "glyph"] as const;

/**
 * The label mode of the bottom bar, set separately. `same` is accepted only
 * because older settings files may carry it.
 */
export type BarLabelMode = LabelMode | "same";

export type Shape = "round" | "soft" | "square";

/**
 * How much the interface moves. Declared here rather than in motion.ts, which
 * imports this file. `storm` is hidden until unlocked (see eggs.tsx).
 */
export type MotionIntensity = "off" | "subtle" | "wild" | "storm";
export type ThemeChoice = "system" | "dark" | "light";

export interface Appearance {
  theme: ThemeChoice;
  accent: string;
  rainbow: boolean;
  /**
   * The rainbow's colours. Empty means the shipped defaults, so an untouched
   * install follows them when they change.
   */
  palette: string[];
  /**
   * Whether pages start at an offset into the palette. The seed is kept
   * separately so it survives turning the switch off and on.
   */
  rainbowRotate: boolean;
  rainbowSeed: number;
  shape: Shape;
  labels: LabelMode;
  /** The bottom bar's label mode; "same" follows `labels`. */
  barLabels: BarLabelMode;
  motion: MotionIntensity;
  /**
   * Whether the app asks for the phone's lock before showing anything. Kept
   * with the appearance so a settings backup does not switch it on elsewhere.
   */
  lock: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "system",
  accent: "#FCC419",
  rainbow: false,
  palette: [],
  rainbowRotate: false,
  rainbowSeed: 0,
  shape: "round",
  labels: "textGlyph",
  barLabels: "textGlyph",
  motion: "wild",
  lock: false,
};

const KEY = "arrowloop.appearance";

let cache: Appearance = DEFAULT_APPEARANCE;
const listeners = new Set<() => void>();

/** Read once at startup, so the first paint is already right. */
export async function loadAppearance(): Promise<Appearance> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<Appearance>;
      // GlimStone 2.0.0 renamed the top motion level from `full` to `wild`,
      // and the motion table has no row for the old value.
      if ((stored.motion as string) === "full") stored.motion = "wild";
      cache = { ...DEFAULT_APPEARANCE, ...stored };
    }
  } catch {
    // An unreadable store counts as a fresh install.
  }
  listeners.forEach((fn) => fn());
  return cache;
}

export function appearance(): Appearance {
  return cache;
}

export function setAppearance(next: Partial<Appearance>): void {
  cache = { ...cache, ...next };
  listeners.forEach((fn) => fn());
  void AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
}

/**
 * Returns the appearance and re-renders when it changes. A subscription
 * rather than a context, since it is read by nearly every control.
 */
export function useAppearance(): Appearance {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return cache;
}

export interface EngineSettings {
  language?: string;
  /** Holds automatic runs while the phone is on battery. */
  notOnBattery?: boolean;
  /** Holds automatic runs on a metered connection. */
  notOnMetered?: boolean;
  [key: string]: unknown;
}

export const settings = {
  async read(): Promise<EngineSettings> {
    const response = await fetch(ORIGIN + "/api/settings");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as EngineSettings;
  },

  /** Merges the patch into the engine's settings. */
  async write(patch: EngineSettings): Promise<void> {
    const response = await fetch(ORIGIN + "/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  },
};

/** The engine's settings, with a setter that writes through. */
export function useEngineSettings(ready: boolean) {
  const [value, setValue] = useState<EngineSettings | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    settings.read().then(setValue, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const update = useCallback(
    async (patch: EngineSettings) => {
      // Applied at once and then reloaded, in case the engine refused.
      setValue((old) => ({ ...(old ?? {}), ...patch }));
      try {
        await settings.write(patch);
      } catch (e) {
        setError((e as Error).message);
      }
      load();
    },
    [load],
  );

  return { settings: value, error, update, reload: load };
}
