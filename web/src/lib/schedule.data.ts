/**
 * What a schedule expression means, without the pickers that edit one, so the
 * Android app reads schedules with the same parser as `components/Schedule.tsx`.
 */

export type ScheduleMode = 'off' | 'live' | 'every' | 'daily' | 'weekly' | 'cron'

/** The weekdays in display order, as cron's numbers (Sunday is 0). */
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
 * Reads "HH:MM" back, falling back to 03:00 rather than throwing, so a
 * hand-edited value stays editable.
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
    // Live writes the backstop interval behind the watcher; the watch flag
    // itself is stored on the job.
    case 'live':
    case 'every': {
      // `@every 6h` counts from the last run, where `*/6` would fire at fixed
      // hours of the clock.
      const n = Math.max(1, Math.round(s.everyCount))
      if (s.everyUnit === 'minute') return `@every ${n}m`
      return `@every ${n * HOURS_IN[s.everyUnit]}h`
    }
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly': {
      // An empty day list would turn the schedule into a daily one.
      const days = s.days.length > 0 ? [...s.days].sort((a, b) => a - b) : [1]
      return `${minute} ${hour} * * ${days.join(',')}`
    }
    case 'cron':
      return s.cron.trim()
  }
}

/**
 * Reads a stored expression back into builder state. Only the shapes this
 * builder writes are recognised; anything else comes back as cron rather than
 * being guessed at.
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
    // The largest whole unit, so "168h" reads as one week.
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
