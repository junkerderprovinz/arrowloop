/**
 * What a schedule expression MEANS, without any of the pickers that edit one.
 *
 * Split out of `components/Schedule.tsx` for the same reason the translation
 * table was split out of `i18n.ts`: the Android app needs to read a schedule
 * and has no use at all for the builder around it. That file imports React,
 * the field components, the info bubble and the time picker, and none of that
 * belongs in a phone that only wants to print "every six hours" on a card.
 *
 * ONE parser, not two. A second reader with its own idea of what `0 3 * * *`
 * means is how a card ends up describing a schedule the editor would show
 * differently, and the person then has two answers and no way to tell which is
 * the real one.
 */

export type ScheduleMode = 'off' | 'live' | 'every' | 'daily' | 'weekly' | 'cron'

/**
 * The weekdays, stored as cron's own numbers so nothing has to be mapped at the
 * point where the expression is written. Sunday is 0, which is cron's own
 * convention and not a choice this file gets to make.
 */
export const WEEKDAYS: { day: number; key: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' }[] = [
  { day: 1, key: 'mon' },
  { day: 2, key: 'tue' },
  { day: 3, key: 'wed' },
  { day: 4, key: 'thu' },
  { day: 5, key: 'fri' },
  { day: 6, key: 'sat' },
  { day: 0, key: 'sun' },
]

/** The units "every N" offers, and how many hours one of them is. Minutes are
 *  their own case because they are the one unit the engine counts directly. */
export type EveryUnit = 'minute' | 'hour' | 'day' | 'week'

export const EVERY_UNITS: EveryUnit[] = ['minute', 'hour', 'day', 'week']

export const HOURS_IN: Record<Exclude<EveryUnit, 'minute'>, number> = { hour: 1, day: 24, week: 168 }

export interface ScheduleState {
  mode: ScheduleMode
  /** "HH:MM", used by both timed modes. */
  time: string
  /** Cron weekday numbers, for the weekly mode. */
  days: number[]
  /** How many, and of what, for the "every N" mode. */
  everyCount: number
  everyUnit: EveryUnit
  /** The raw expression, for the mode that keeps one. */
  cron: string
}

export const DEFAULT_SCHEDULE: ScheduleState = {
  mode: 'off',
  time: '03:00',
  days: [1],
  everyCount: 6,
  everyUnit: 'hour',
  cron: '',
}

export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * Reads "HH:MM" back, falling back to a sensible hour rather than throwing.
 *
 * A stored value can be anything: a hand-edited configuration file, a schedule
 * written before this picker existed. Refusing to render is the one behaviour
 * that would make such a value uneditable, which is the opposite of what an
 * editor is for.
 */
export function parseTime(value: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim())
  if (!m) return { hour: 3, minute: 0 }
  const hour = Math.min(23, Math.max(0, parseInt(m[1] ?? '3', 10)))
  const minute = Math.min(59, Math.max(0, parseInt(m[2] ?? '0', 10)))
  return { hour, minute }
}

/** The cron expression a state describes. Empty means no schedule at all. */
export function buildSchedule(s: ScheduleState): string {
  const { hour, minute } = parseTime(s.time)
  switch (s.mode) {
    case 'off':
      return ''
    // Real time writes the same expression the "every N" mode does, because
    // that IS what it writes: the backstop behind the watcher. The two differ
    // in whether the job also watches, which is stored on the job rather than
    // in the expression.
    case 'live':
    case 'every': {
      // `@every` rather than a step expression, because the two are not the
      // same promise: `*/6` in the hours column fires at 0, 6, 12 and 18
      // o'clock, so "every six hours" set at five o'clock waits one hour and
      // then keeps to a clock nobody asked about. `@every 6h` counts from the
      // last run, which is what the words say.
      const n = Math.max(1, Math.round(s.everyCount))
      if (s.everyUnit === 'minute') return `@every ${n}m`
      return `@every ${n * HOURS_IN[s.everyUnit]}h`
    }
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly': {
      // Never emit an empty day list: "* * *" with no weekday would quietly
      // turn a weekly schedule into a daily one, which is a change nobody asked
      // for made at the moment they unticked the last day.
      const days = s.days.length > 0 ? [...s.days].sort((a, b) => a - b) : [1]
      return `${minute} ${hour} * * ${days.join(',')}`
    }
    case 'cron':
      return s.cron.trim()
  }
}

/**
 * Reads a stored expression back into builder state.
 *
 * Only the shapes this builder itself writes are recognised. Anything else,
 * including an expression that is perfectly valid, comes back as cron: the
 * alternative is guessing, and a guess here rewrites somebody's schedule.
 */
export function parseSchedule(raw: string): ScheduleState {
  const s = (raw ?? '').trim()
  if (!s) return { ...DEFAULT_SCHEDULE, mode: 'off' }

  const every = /^@every\s+(\d+)([mh])$/.exec(s)
  if (every) {
    const n = parseInt(every[1] ?? '0', 10)
    if (every[2] === 'm') {
      return { ...DEFAULT_SCHEDULE, mode: 'every', everyCount: n, everyUnit: 'minute' }
    }
    // Hours come back as the largest whole unit they divide into, so "168h"
    // reads as one week rather than as a hundred and sixty-eight hours.
    for (const unit of ['week', 'day'] as const) {
      if (n % HOURS_IN[unit] === 0) {
        return { ...DEFAULT_SCHEDULE, mode: 'every', everyCount: n / HOURS_IN[unit], everyUnit: unit }
      }
    }
    return { ...DEFAULT_SCHEDULE, mode: 'every', everyCount: n, everyUnit: 'hour' }
  }

  const daily = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/.exec(s)
  if (daily) {
    return {
      ...DEFAULT_SCHEDULE,
      mode: 'daily',
      time: formatTime(parseInt(daily[2] ?? '3', 10), parseInt(daily[1] ?? '0', 10)),
    }
  }

  const weekly = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-6](?:,[0-6])*)$/.exec(s)
  if (weekly) {
    return {
      ...DEFAULT_SCHEDULE,
      mode: 'weekly',
      time: formatTime(parseInt(weekly[2] ?? '3', 10), parseInt(weekly[1] ?? '0', 10)),
      days: (weekly[3] ?? '1').split(',').map((d) => parseInt(d, 10)),
    }
  }

  return { ...DEFAULT_SCHEDULE, mode: 'cron', cron: s }
}
