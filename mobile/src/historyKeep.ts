import { keepDays, keepSetting } from "../../web/src/lib/historyKeep.ts";

export { keepSetting };

/** How long the history keeps a run, as the web's History card reads historyKeep. */
export function keepOf(raw: unknown): { days: number; forever: boolean } {
  const days = keepDays(typeof raw === "string" ? raw : undefined);
  return { days, forever: days === 0 };
}

/** historyKeep once Keep forever is switched, back to the days it had before when it goes off. */
export function afterSwitch(on: boolean, before: number | null): string {
  return keepSetting(on ? 0 : (before ?? keepDays(undefined)));
}
