import { getCalendars, getLocales } from "expo-localization";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { dateLocale } from "../../web/src/lib/dateLocale";
import { hourCycle } from "../../web/src/lib/hourCycle";
import { exactMoment } from "../../web/src/lib/reasonText";

/** Whether Android's clock is set to 24-hour time, or null where it does not say. */
function phoneClock(): boolean | null {
  return getCalendars()[0]?.uses24hourClock ?? null;
}

/** The region Android is set to, which orders the day and month whatever language the app speaks. */
function phoneRegion(): string | null {
  return getLocales()[0]?.regionCode ?? null;
}

// Read again whenever the app comes back, since both are changed in Android's
// own settings while the app waits behind them.
let uses24 = phoneClock();
let region = phoneRegion();
const listeners = new Set<() => void>();
AppState.addEventListener("change", (state) => {
  if (state !== "active") return;
  const clock = phoneClock();
  const place = phoneRegion();
  if (clock === uses24 && place === region) return;
  uses24 = clock;
  region = place;
  for (const listener of listeners) listener();
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The phone's clock and region as one value that changes when either does, so
 * a screen that spells times while it renders can render again.
 */
export function useClockLayout(): string {
  return useSyncExternalStore(subscribe, () => `${uses24}/${region}`);
}

/** A moment in the app's language, laid out the way the phone's region and clock show it. */
function spelled(iso: string, lang: string, parts: Intl.DateTimeFormatOptions): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "-";
  const options = { ...parts, ...hourCycle(uses24) };
  try {
    return at.toLocaleString(dateLocale(lang, region), options);
  } catch {
    // An unknown language tag falls back to the default locale.
    return at.toLocaleString(undefined, options);
  }
}

/**
 * Formats a moment as an absolute date and time in the app's language. A
 * relative "5 minutes ago" would need each unit's plural forms, which Hermes'
 * Intl cannot supply, and it cannot express a time in the future such as the
 * next run.
 */
export function clock(iso: string, lang: string): string {
  return spelled(iso, lang, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** A moment with its year, for what is kept long enough to be from another one. */
export function dated(iso: string, lang: string): string {
  return spelled(iso, lang, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * A moment spelled out with its weekday, month and year, for a choice that
 * turns on which of two files is older.
 */
export function fullClock(iso: string, lang: string): string {
  return spelled(iso, lang, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A moment to the second, for a reason that compares two times a file had. */
export function exactly(iso: string, lang: string): string {
  return exactMoment(iso, dateLocale(lang, region), hourCycle(uses24));
}

/** A time of day such as a schedule's, which has no date. */
export function timeOfDay(hour: number, minute: number, lang: string): string {
  const at = new Date();
  at.setHours(hour, minute, 0, 0);
  return spelled(at.toISOString(), lang, { hour: "2-digit", minute: "2-digit" });
}
