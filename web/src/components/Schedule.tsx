import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import { hueVars, rainbowAt } from '../lib/appearance'

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
  const seen = useRef(value)
  useEffect(() => {
    if (seen.current !== value) {
      seen.current = value
      setMode(live ? 'live' : parseSchedule(value).mode)
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
    // An empty cron field starts from the schedule already set.
    if (next === 'cron' && state.cron.trim() === '') {
      const from = state.mode === 'off' || state.mode === 'live' ? 'daily' : state.mode
      update({ mode: next, cron: buildSchedule({ ...state, mode: from }) })
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

  return (
    <div className="flex flex-col gap-3">
      <Selector<ScheduleMode>
        scale="small"
        label={t('edit.schedule')}
        value={state.mode}
        onChange={pick}
        options={SCHEDULE_MODES.map((m) => ({ value: m, label: t(`schedule.${m}` as const) }))}
      />

      {state.mode === 'live' && (
        <div className="flex flex-col gap-3">
          {onSettle && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-carbon-textMuted">
                {t('schedule.settle')}
                <InfoBubble tip={t('schedule.settleHint')} />
              </span>
              <QuietPeriod value={settle ?? ''} onChange={onSettle} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-carbon-textMuted">
              {t('schedule.backstop')}
              <InfoBubble tip={t('schedule.backstopHint')} />
            </span>
            <EveryPicker state={state} update={update} />
          </div>
        </div>
      )}

      {state.mode === 'every' && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-carbon-textMuted">
            {t('schedule.everyLabel')}
          </span>
          <EveryPicker state={state} update={update} />
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
                    borderRadius: 'var(--radius-control)',
                    ...(hueVars(rainbowAt(i)) as CSSProperties),
                  }}
                  className={`glim-hue px-2.5 py-1 text-xs font-medium transition-colors ${
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
