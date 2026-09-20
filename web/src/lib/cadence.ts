// In lib rather than in the component, so the phone can read a schedule
// without pulling React in behind it.
import { EVERY_UNITS, WEEKDAYS, parseSchedule, type EveryUnit } from './schedule.data'
import type { Translate } from './i18n.data'

/**
 * A schedule, in words.
 *
 * It reads through `parseSchedule` rather than matching the expression itself,
 * so the card and the editor cannot disagree about what a schedule means. The
 * watch flag is not part of the expression and arrives separately.
 */
export type Cadence =
  | { kind: 'none' }
  | { kind: 'live' }
  | { kind: 'every'; count: number; unit: EveryUnit }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; days: number[]; time: string }
  | { kind: 'cron'; expression: string }

export function readCadence(schedule: string, watch: boolean): Cadence {
  // A watching job's schedule is only its backstop.
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
 * An interval of one has its own phrase per unit, because `schedule.unit.*` is
 * a plain plural in every table and would print "every hours". Plural forms are
 * not split, since languages with "few" and "many" rules would then fall
 * through to English at the commonest counts.
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
      // An expression the builder cannot write is shown as written rather than
      // paraphrased.
      return t('jobs.cadence.cron', { expression: c.expression })
  }
}

// In the week's row order rather than cron's numbers, which start on Sunday.
function weekdayNames(days: number[], t: Translate): string {
  const picked = WEEKDAYS.filter((d) => days.includes(d.day))
  return picked.map((d) => t(`schedule.day.${d.key}` as const)).join(', ')
}

/** Guards against a unit list that grows without this file noticing. */
export const CADENCE_UNITS = EVERY_UNITS
