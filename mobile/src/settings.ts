import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { ORIGIN } from "./api";

/**
 * Two kinds of setting, kept apart on purpose.
 *
 * APPEARANCE belongs to the phone. Which accent, whether the rainbow is on,
 * how much text a button shows, light or dark - none of that should follow a
 * container that a household might share, and a phone held at arm's length
 * wants different answers from a monitor anyway. It lives in AsyncStorage.
 *
 * BEHAVIOUR belongs to the engine. The language, whether automatic runs wait
 * for mains power or a connection nobody pays for by the megabyte - those are
 * facts about the sync, and the engine is the thing that syncs. They go
 * through its settings API, which merges rather than replaces, so an app that
 * has never heard of a key cannot remove it by not mentioning it.
 */

export type LabelMode = "text" | "textGlyph" | "glyph" | "reactive";
export type Shape = "round" | "soft" | "square";
export type ThemeChoice = "system" | "dark" | "light";

export interface Appearance {
  theme: ThemeChoice;
  accent: string;
  rainbow: boolean;
  /** Rest neutral, colour where the eye is. */
  rainbowReactive: boolean;
  shape: Shape;
  labels: LabelMode;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "system",
  accent: "#FCC419",
  rainbow: false,
  rainbowReactive: false,
  shape: "round",
  labels: "textGlyph",
};

const KEY = "arrowloop.appearance";

let cache: Appearance = DEFAULT_APPEARANCE;
const listeners = new Set<() => void>();

/** Read once at startup, so the first paint is already right. */
export async function loadAppearance(): Promise<Appearance> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) cache = { ...DEFAULT_APPEARANCE, ...(JSON.parse(raw) as Partial<Appearance>) };
  } catch {
    // A store that cannot be read is a fresh install as far as this is
    // concerned. Defaults are a working app; a thrown error at startup is not.
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
 * The appearance, re-rendering every screen that asks when it changes.
 *
 * A subscription rather than a context, for the same reason GlimStone's web
 * side uses a window event: this is edited in ONE place and read in every
 * control on every screen, and threading a provider through all of them would
 * be a lot of wiring for a value that changes twice a year.
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

// ---------------------------------------------------------------------------
// The engine's own settings.
// ---------------------------------------------------------------------------

export interface EngineSettings {
  language?: string;
  /** Hold automatic runs while the phone is on its battery. Autosync calls
   *  this "only while charging", and it is the same question. */
  notOnBattery?: boolean;
  /** Hold them on a connection somebody pays for by the megabyte, which on a
   *  phone means mobile data. Autosync's "wifi only". */
  notOnMetered?: boolean;
  [key: string]: unknown;
}

export const settings = {
  async read(): Promise<EngineSettings> {
    const response = await fetch(ORIGIN + "/api/settings");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as EngineSettings;
  },

  /** MERGES. Send only what changed - the engine keeps everything else. */
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
      // Optimistic, then reloaded. A toggle that waits for a round trip before
      // moving feels broken on a phone, and the reload is what keeps it honest
      // if the engine refused.
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
