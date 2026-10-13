import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import { hueVars } from '../lib/appearance'

import { Selector } from './Selector'
import { Choice, NumberField, Text } from './Field'
import { DEFAULT_QUIET, QuietPeriod } from './QuietPeriod'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { TimePicker } from './TimePicker'
// The parsing lives in lib because the phone reads schedules too.
import {
  EVERY_UNITS,
  WEEKDAYS,
  buildSchedule,
  parseSchedule,
  type EveryUnit,
  type ScheduleMode,
  type ScheduleState,
} from '../lib/schedule.data'
import { useT } from '../lib/i18n'

/**
 * A schedule, built with pickers and stored as the cron expression the engine
 * reads. An expression the pickers cannot say opens in the cron mode verbatim
 * rather than being simplified.
 */
export type { ScheduleMode, ScheduleState, EveryUnit } from '../lib/schedule.data'
export {
  DEFAULT_SCHEDULE,
  EVERY_UNITS,
  WEEKDAYS,
  buildSchedule,
  parseSchedule,
} from '../lib/schedule.data'

/**
 * The schedule modes, with real time as one of them. A watcher can miss an
 * event, so real time also writes an "every N" backstop schedule, shown and
 * editable, and the engine refuses a watching job without one.
 */
export const SCHEDULE_MODES: ScheduleMode[] = ['off', 'live', 'every', 'daily', 'weekly', 'cron']

/**
 * The backstop real time starts with. It only catches events the watcher
 * missed, so an hour: shorter makes the watcher pointless, longer leaves a miss
 * unnoticed for most of a day.
 */
export const BACKSTOP: { count: number; unit: EveryUnit } = { count: 1, unit: 'hour' }

/** The settle time real time starts with, for the same reason as DEFAULT_QUIET. */
export const DEFAULT_SETTLE = DEFAULT_QUIET

export function ScheduleField({
  value,
  onChange,
  live,
  onLive,
  settle,
  onSettle,
}: {
  value: string
  onChange: (next: string) => void
  /**
   * Whether the job watches for changes, which is the `live` mode. The
   * expression cannot say it, since real time and "every N" write the same one.
   */
  live?: boolean
  onLive?: (next: boolean) => void
  /** How long the tree must go quiet before a change counts as finished. */
  settle?: string
  onSettle?: (next: string) => void
}) {
  const { t } = useT()
  const derived = parseSchedule(value)

  // The mode is held rather than derived from the expression, which cannot
  // tell cron from the daily schedule it was seeded with, "every 24h" from
  // daily, or real time from "every N". It is re-seeded whenever the value
  // changes from outside, so another job never opens in the last one's mode.
  const [mode, setMode] = useState<ScheduleMode>(live ? 'live' : derived.mode)
  // The expression as typed, since the stored one is trimmed and a space
  // between two fields would vanish as it is typed.
  const [cron, setCron] = useState(value)
  const seen = useRef(value)
  useEffect(() => {
    if (seen.current !== value) {
      seen.current = value
      setMode(live ? 'live' : parseSchedule(value).mode)
      setCron(value)
    }
  }, [value, live])

  const state: ScheduleState = { ...derived, mode }

  function update(patch: Partial<ScheduleState>) {
    const next = { ...state, ...patch }
    if (patch.mode !== undefined) setMode(patch.mode)
    const built = buildSchedule(next)
    seen.current = built
    onChange(built)
  }

  // Real time also sets the watch flag, so every other mode clears it.
  function pick(next: ScheduleMode) {
    if (next === 'live') {
      onLive?.(true)
      if (onSettle && (settle ?? '').trim() === '') onSettle(DEFAULT_SETTLE)
      // The engine refuses a watching job with no schedule, so one is seeded;
      // an existing cadence is kept.
      const seeded =
        state.mode === 'off' || value.trim() === ''
          ? { everyCount: BACKSTOP.count, everyUnit: BACKSTOP.unit }
          : {}
      update({ mode: next, ...seeded })
      return
    }
    onLive?.(false)
    // The field starts from the schedule already set, written out.
    if (next === 'cron') {
      const text = state.mode === 'off' || state.mode === 'live' ? buildSchedule({ ...state, mode: 'daily' }) : value.trim()
      setCron(text)
      update({ mode: next, cron: text })
      return
    }
    update({ mode: next })
  }

  function toggleDay(day: number) {
    const next = state.days.includes(day)
      ? state.days.filter((d) => d !== day)
      : [...state.days, day]
    // No days would silently mean daily.
    if (next.length === 0) return
    update({ days: next })
  }

  // Real time belongs to a job; a default schedule has nobody to watch for.
  const modes = onLive ? SCHEDULE_MODES : SCHEDULE_MODES.filter((m) => m !== 'live')

  return (
    <div className="flex flex-col gap-3 @container">
      <Selector<ScheduleMode>
        scale="small"
        label={t('edit.schedule')}
        value={state.mode}
        onChange={pick}
        options={modes.map((m) => ({ value: m, label: t(`schedule.${m}` as const) }))}
      />

      {/* Every labelled row shares one grid, its names at the start and its
          boxes at the end, as in a settings card. A narrow panel puts each
          box under its name, still at the end. */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 @md:grid-cols-[max-content_minmax(0,1fr)] @md:items-center @md:gap-y-3">
        {state.mode === 'live' && onSettle && (
          <Row label={t('schedule.settle')} hint={t('schedule.settleHint')}>
            <QuietPeriod value={settle ?? ''} onChange={onSettle} />
          </Row>
        )}
        {state.mode === 'live' && (
          <Row label={t('schedule.backstop')} hint={t('schedule.backstopHint')}>
            <EveryPicker state={state} update={update} />
          </Row>
        )}
        {state.mode === 'every' && (
          <Row label={t('schedule.everyLabel')}>
            <EveryPicker state={state} update={update} />
          </Row>
        )}
        {(state.mode === 'daily' || state.mode === 'weekly') && (
          <Row label={t('schedule.at')}>
            <TimePicker value={state.time} label={t('schedule.at')} onChange={(time) => update({ time })} />
          </Row>
        )}
        {state.mode === 'weekly' && (
          <Row label={t('schedule.days')}>
            <div
              className="glim-well flex flex-wrap gap-[0.2rem] p-[0.2rem]"
              style={{ borderRadius: 'var(--radius-pill)' }}
            >
              {/* Each day takes its own palette position, like every multi-part
                  control. */}
              {WEEKDAYS.map(({ day, key }, i) => {
                const on = state.days.includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDay(day)}
                    style={{
                      borderRadius: 'var(--radius-pill)',
                      ...(hueVars(i) as CSSProperties),
                    }}
                    className={`glim-hue grow px-2.5 py-1 text-meta font-medium transition-colors ${
                      on
                        ? 'bg-accent text-accentContrast hover:bg-accentHover'
                        : 'bg-transparent text-carbon-textMuted hover:bg-carbon-hover hover:text-carbon-text'
                    }`}
                  >
                    {t(`schedule.day.${key}` as const)}
                  </button>
                )
              })}
            </div>
          </Row>
        )}
      </div>

      {state.mode === 'cron' && (
        <Text
          value={cron}
          onChange={(text) => {
            setCron(text)
            update({ cron: text })
          }}
          placeholder="0 */6 * * *"
          mono
        />
      )}
    </div>
  )
}

/** One labelled row of the schedule's grid: the label cell and the box cell. */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <>
      <span className="mt-1.5 flex items-center gap-1.5 text-meta uppercase tracking-wider text-carbon-textMuted first:mt-0 @md:mt-0">
        {label}
        {hint && <InfoBubble tip={hint} />}
      </span>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{children}</div>
    </>
  )
}

/** How many, and of what: shared by the cadence and the backstop. */
function EveryPicker({
  state,
  update,
}: {
  state: ScheduleState
  update: (patch: Partial<ScheduleState>) => void
}) {
  const { t } = useT()
  return (
    <>
      <NumberField
        value={state.everyCount}
        min={1}
        max={999}
        label={t('schedule.everyLabel')}
        onChange={(everyCount) => update({ everyCount })}
      />
      {/* The same fixed column as the quiet period's unit picker. */}
      <div className="w-32 shrink-0">
        <Choice<EveryUnit>
          value={state.everyUnit}
          label={t('edit.quietUnit')}
          onChange={(everyUnit) => update({ everyUnit })}
          options={EVERY_UNITS.map((u) => ({ value: u, label: t(`schedule.unit.${u}` as const) }))}
        />
      </div>
    </>
  )
}
