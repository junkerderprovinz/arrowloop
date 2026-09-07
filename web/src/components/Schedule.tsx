import { useEffect, useRef, useState } from 'react'

import { Selector } from './Selector'
import { NumberField, Text } from './Field'
import { TimePicker, formatTime, parseTime } from './TimePicker'
import { useT } from '../lib/i18n'

/**
 * A schedule, built rather than typed.
 *
 * The stored value stays a cron expression, because that is what the engine
 * reads and what a hand-edited configuration file contains. What changes is
 * that nobody has to write one: the common answers are pickers, and the
 * expression is derived. The raw field stays for anything the pickers cannot
 * say, since inventing a control for every cron shape would be a worse editor
 * than the line somebody already knows how to write.
 *
 * Reading in the other direction is what makes this safe to open: an expression
 * this builder cannot express is not rewritten, it lands in the cron mode
 * verbatim. An editor that silently simplified a schedule it did not understand
 * would destroy the one thing it was opened to look at.
 */
export type ScheduleMode = 'off' | 'every' | 'daily' | 'weekly' | 'cron'

export const SCHEDULE_MODES: ScheduleMode[] = ['off', 'every', 'daily', 'weekly', 'cron']

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

const HOURS_IN: Record<Exclude<EveryUnit, 'minute'>, number> = { hour: 1, day: 24, week: 168 }

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

/** The cron expression a state describes. Empty means no schedule at all. */
export function buildSchedule(s: ScheduleState): string {
  const { hour, minute } = parseTime(s.time)
  switch (s.mode) {
    case 'off':
      return ''
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
    const n = parseInt(every[1], 10)
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
      time: formatTime(parseInt(daily[2], 10), parseInt(daily[1], 10)),
    }
  }

  const weekly = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-6](?:,[0-6])*)$/.exec(s)
  if (weekly) {
    return {
      ...DEFAULT_SCHEDULE,
      mode: 'weekly',
      time: formatTime(parseInt(weekly[2], 10), parseInt(weekly[1], 10)),
      days: weekly[3].split(',').map((d) => parseInt(d, 10)),
    }
  }

  return { ...DEFAULT_SCHEDULE, mode: 'cron', cron: s }
}

export function ScheduleField({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const { t } = useT()
  const derived = parseSchedule(value)

  /**
   * The mode is held here, not derived on every render, and that is the whole
   * bug fix.
   *
   * It used to be read back out of the stored expression each time. That works
   * for every mode but one: switching to cron seeds the field from the
   * schedule already set, so the stored string was something like "0 3 * * *",
   * and reading it back said "daily". The picker jumped straight back the
   * moment it was pressed ("Ausdruck ... das funktioniert auch noch nicht").
   * The same trap catches "every 24h" and "daily", which describe the same
   * cadence and cannot be told apart from the expression alone.
   *
   * The stored value is still the single source of truth for the SETTINGS. Only
   * the choice of which picker is open lives here, and it is re-seeded whenever
   * the value changes from outside, so opening another job never shows the last
   * one's mode.
   */
  const [mode, setMode] = useState<ScheduleMode>(derived.mode)
  const seen = useRef(value)
  useEffect(() => {
    if (seen.current !== value) {
      seen.current = value
      setMode(parseSchedule(value).mode)
    }
  }, [value])

  const state: ScheduleState = { ...derived, mode }

  function update(patch: Partial<ScheduleState>) {
    const next = { ...state, ...patch }
    if (patch.mode !== undefined) setMode(patch.mode)
    const built = buildSchedule(next)
    seen.current = built
    onChange(built)
  }

  function toggleDay(day: number) {
    const next = state.days.includes(day)
      ? state.days.filter((d) => d !== day)
      : [...state.days, day]
    // At least one day always stays picked, for the same reason buildSchedule
    // refuses an empty list: the alternative is a silent switch to daily.
    if (next.length === 0) return
    update({ days: next })
  }

  return (
    <div className="flex flex-col gap-3">
      <Selector<ScheduleMode>
        scale="small"
        label={t('edit.schedule')}
        value={state.mode}
        onChange={(next) => {
          // Entering the cron mode with nothing in the field starts from the
          // schedule that was already set, so the expression is editable rather
          // than empty and invalid.
          if (next === 'cron' && state.cron.trim() === '') {
            update({
              mode: next,
              cron: buildSchedule({ ...state, mode: state.mode === 'off' ? 'daily' : state.mode }),
            })
            return
          }
          update({ mode: next })
        }}
        options={SCHEDULE_MODES.map((m) => ({ value: m, label: t(`schedule.${m}` as const) }))}
      />

      {state.mode === 'every' && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-carbon-textMuted">
            {t('schedule.everyLabel')}
          </span>
          <NumberField
            value={state.everyCount}
            min={1}
            max={999}
            label={t('schedule.everyLabel')}
            onChange={(everyCount) => update({ everyCount })}
          />
          <Selector<EveryUnit>
            scale="small"
            value={state.everyUnit}
            onChange={(everyUnit) => update({ everyUnit })}
            options={EVERY_UNITS.map((u) => ({ value: u, label: t(`schedule.unit.${u}` as const) }))}
          />
        </div>
      )}

      {(state.mode === 'daily' || state.mode === 'weekly') && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-carbon-textMuted">
            {t('schedule.at')}
          </span>
          <TimePicker value={state.time} label={t('schedule.at')} onChange={(time) => update({ time })} />
        </div>
      )}

      {state.mode === 'weekly' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-carbon-textMuted">
            {t('schedule.days')}
          </span>
          <div
            className="glim-well inline-flex flex-wrap gap-[0.2rem] p-[0.2rem]"
            style={{ borderRadius: 'var(--radius-control)' }}
          >
            {WEEKDAYS.map(({ day, key }) => {
              const on = state.days.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(day)}
                  style={{ borderRadius: 'calc(var(--radius-control) - 0.2rem)' }}
                  className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                    on
                      ? 'bg-accent text-accentContrast'
                      : 'bg-transparent text-carbon-textMuted hover:bg-carbon-hover hover:text-carbon-text'
                  }`}
                >
                  {t(`schedule.day.${key}` as const)}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {state.mode === 'cron' && (
        <Text
          value={state.cron}
          onChange={(cron) => update({ cron })}
          placeholder="0 */6 * * *"
          mono
        />
      )}
    </div>
  )
}
