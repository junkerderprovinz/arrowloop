import { Selector } from './Selector'
import { Text } from './Field'
import { TimePicker, formatTime, parseTime } from './TimePicker'
import { useT } from '../lib/i18n'

/**
 * A schedule, built rather than typed.
 *
 * The stored value stays a cron expression, because that is what the engine
 * reads and what a hand-edited configuration file contains. What changes is
 * that nobody has to write one: the common two answers, every day at a time and
 * certain weekdays at a time, are a picker, and the expression is derived. The
 * raw field stays for the third case, since a cadence like "every six hours"
 * has no picker and inventing one would be a worse editor than the line of cron
 * somebody already knows how to write.
 *
 * Reading in the other direction is what makes this safe to open: an expression
 * this builder cannot express is not rewritten, it lands in the raw mode
 * verbatim. An editor that silently simplified a schedule it did not understand
 * would destroy the one thing it was opened to look at.
 */
export type ScheduleMode = 'off' | 'daily' | 'weekly' | 'cron'

export const SCHEDULE_MODES: ScheduleMode[] = ['off', 'daily', 'weekly', 'cron']

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

export interface ScheduleState {
  mode: ScheduleMode
  /** "HH:MM", used by both timed modes. */
  time: string
  /** Cron weekday numbers, for the weekly mode. */
  days: number[]
  /** The raw expression, for the mode that keeps one. */
  cron: string
}

export const DEFAULT_SCHEDULE: ScheduleState = {
  mode: 'off',
  time: '03:00',
  days: [1],
  cron: '',
}

/** The cron expression a state describes. Empty means no schedule at all. */
export function buildSchedule(s: ScheduleState): string {
  const { hour, minute } = parseTime(s.time)
  switch (s.mode) {
    case 'off':
      return ''
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
 * Only the two shapes this builder itself writes are recognised. Anything else,
 * including an expression that is perfectly valid, comes back as raw: the
 * alternative is guessing, and a guess here rewrites somebody's schedule.
 */
export function parseSchedule(raw: string): ScheduleState {
  const s = (raw ?? '').trim()
  if (!s) return { ...DEFAULT_SCHEDULE, mode: 'off' }

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
  // Derived from the stored value on every render rather than held in state of
  // its own. One source of truth means the field cannot drift out of step with
  // the job it is editing, which is what happens the moment a copy exists.
  const state = parseSchedule(value)

  function update(patch: Partial<ScheduleState>) {
    onChange(buildSchedule({ ...state, ...patch }))
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
        onChange={(mode) => {
          // Entering the raw mode with nothing in the field starts from the
          // schedule that was already set, so the expression is editable rather
          // than empty and invalid.
          if (mode === 'cron' && state.cron.trim() === '') {
            update({ mode, cron: buildSchedule({ ...state, mode: state.mode === 'off' ? 'daily' : state.mode }) })
            return
          }
          update({ mode })
        }}
        options={SCHEDULE_MODES.map((m) => ({ value: m, label: t(`schedule.${m}` as const) }))}
      />

      {(state.mode === 'daily' || state.mode === 'weekly') && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] uppercase tracking-wider text-carbon-textMuted">
            {t('schedule.at')}
          </span>
          <TimePicker value={state.time} label={t('schedule.at')} onChange={(time) => update({ time })} />
        </div>
      )}

      {state.mode === 'weekly' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-carbon-textMuted">
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
                  className={`px-2.5 py-1 text-[12px] font-medium transition-colors ${
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
