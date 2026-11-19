import { amount } from './anomalies'
import type { Translate } from './i18n.data'

/**
 * Returns how long a run took, in the units a job's usual run time is given
 * in, or null while it runs. Minutes and seconds as 0:31 read as a time of day.
 */
export function runLength(run: { Started: string; Finished: string; Running?: boolean }, t: Translate): string | null {
  if (run.Running || !run.Finished) return null
  const secs = Math.max(0, Math.round((Date.parse(run.Finished) - Date.parse(run.Started)) / 1000))
  return amount('duration', secs, t)
}
