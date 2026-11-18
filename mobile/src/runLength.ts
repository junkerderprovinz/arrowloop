import { amount } from "../../web/src/lib/anomalies.ts";
import type { T } from "./i18n";

/**
 * Returns how long a run took, in the units a job's usual run time is given
 * in, or null while it runs. Minutes and seconds as 0:31 read as a time of day.
 */
export function runLength(started: string, finished: string | undefined, t: T): string | null {
  if (!finished) return null;
  const secs = Math.max(0, Math.round((new Date(finished).getTime() - new Date(started).getTime()) / 1000));
  return amount("duration", secs, t);
}
