import {
  EVERY_UNITS,
  WEEKDAYS,
  parseSchedule,
  type EveryUnit,
} from '../components/Schedule'
import type { Translate } from './i18n'

/**
 * A schedule, in words.
 *
 * The card used to print the stored expression: `@every 6h` on one job and
 * `0 3 * * 1,5` on another, which is the engine's vocabulary shown to somebody
 * who never asked to learn it. jdp: "rechts oben in der card soll stehen laeuft
 * ... (und dann der Zeitplan, z.b alle 3 stunden)."
 *
 * It reads through `parseSchedule`, deliberately, rather than matching the
 * expression itself. That parser already knows exactly which shapes the builder
 * writes and refuses to guess at anything else, and a second reader with its own
 * idea of what `0 3 * * *` means is how a card ends up describing a schedule the
 * editor would show differently.
 *
 * Real time is not in the expression at all - it is the watch flag - so it
 * arrives as a separate argument for the same reason the editor holds it
 * separately.
 */
export type Cadence =
  | { kind: 'none' }
  | { kind: 'live' }
  | { kind: 'every'; count: number; unit: EveryUnit }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; days: number[]; time: string }
  | { kind: 'cron'; expression: string }

export function readCadence(schedule: string, watch: boolean): Cadence {
  // Watching wins, because a watching job's schedule is its backstop rather
  // than its cadence: saying "every hour" about a job that reacts in seconds
  // would be true and would describe the wrong thing.
  if (watch) return { kind: 'live' }
  const s = parseSchedule(schedule)
  switch (s.mode) {
    case 'off':
      return { kind: 'none' }
    case 'every':
      return { kind: 'every', count: s.everyCount, unit: s.everyUnit }
    case 'daily':
      return { kind: 'daily', time: s.time }
    case 'weekly':
      return { kind: 'weekly', days: s.days, time: s.time }
    default:
      return { kind: 'cron', expression: s.cron }
  }
}

/**
 * The words for a cadence.
 *
 * An interval of one gets a phrase of its own per unit rather than the number
 * and the plural unit, and that is not a nicety: `schedule.unit.*` is a PLAIN
 * PLURAL in all forty-two tables, on purpose, because splitting it into one-and-
 * other forms would make every language whose rules select "few" or "many" fall
 * through to English at the commonest counts. Reusing it for one would print
 * "every hours". So one is four whole sentences, written by a translator, and
 * every other count keeps the number in front of the plural, which is what the
 * existing rule already produces correctly.
 */
export function describeCadence(c: Cadence, t: Translate): string {
  switch (c.kind) {
    case 'none':
      return t('jobs.schedule.onRequest')
    case 'live':
      return t('jobs.cadence.live')
    case 'every':
      if (c.count <= 1) return t(`jobs.cadence.everyOne.${c.unit}` as const)
      return t('jobs.cadence.every', {
        n: c.count,
        unit: t(`schedule.unit.${c.unit}` as const),
      })
    case 'daily':
      return t('jobs.cadence.daily', { time: c.time })
    case 'weekly':
      return t('jobs.cadence.weekly', { days: weekdayNames(c.days, t), time: c.time })
    case 'cron':
      // The one cadence with no words. An expression this app's own builder
      // cannot express is one somebody wrote deliberately, and paraphrasing it
      // would be a guess printed as a fact.
      return t('jobs.cadence.cron', { expression: c.expression })
  }
}

/**
 * The picked weekdays, in the week's own order.
 *
 * Sorted by the row order rather than by cron's numbers, because cron starts its
 * week on Sunday and a person reading "So, Mo, Fr" wonders why Sunday is first.
 */
function weekdayNames(days: number[], t: Translate): string {
  const picked = WEEKDAYS.filter((d) => days.includes(d.day))
  return picked.map((d) => t(`schedule.day.${d.key}` as const)).join(', ')
}

/** Guards against a unit list that grows without this file noticing. */
export const CADENCE_UNITS = EVERY_UNITS
