import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import { hueVars, rainbowAt } from '../lib/appearance'

import { Selector } from './Selector'
import { Choice, NumberField, Text } from './Field'
import { DEFAULT_QUIET, QuietPeriod } from './QuietPeriod'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { TimePicker } from './TimePicker'
// The parsing and the shapes live in lib now, because the phone reads a
// schedule and has no use for the pickers around it. Re-exported below so
// every existing import of this file still finds them.
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
export type { ScheduleMode, ScheduleState, EveryUnit } from '../lib/schedule.data'
export {
  DEFAULT_SCHEDULE,
  EVERY_UNITS,
  WEEKDAYS,
  buildSchedule,
  parseSchedule,
} from '../lib/schedule.data'

/**
 * Real time is a POSITION in this list, not a switch beside it.
 *
 * It shipped as a switch, with a comment explaining why it could not be a mode:
 * a watcher only covers a local side, it can miss an event and never know it
 * did, and the schedule is what eventually notices. All of that is still true.
 * What was wrong was the conclusion. jdp: "Echtzeit soll ein eigener Punkt im
 * zeitplan selektor sein. also ein eigener zeitplan. kein toggle." A person
 * choosing how a job runs is choosing one answer, and offering four answers in
 * a strip plus a fifth as a switch underneath makes the fifth read as an extra
 * rather than as an option - which is exactly how it was found missing in the
 * first place ("zeitplan: echtzeit option fehlt").
 *
 * The engine's requirement survives as the BACKSTOP: picking real time still
 * writes a schedule, shown right there and editable, and the engine refuses a
 * watching job that has none. So the safety net is visible instead of implied,
 * which is better than where it was. The one thing that goes is watching
 * combined with a daily or weekly schedule; a backstop is a cadence, and
 * "every N" says that.
 */
export const SCHEDULE_MODES: ScheduleMode[] = ['off', 'live', 'every', 'daily', 'weekly', 'cron']

/**
 * What the backstop is when real time is picked and nothing else says.
 *
 * An hour, because the backstop is not the mechanism: it is what catches the
 * event the watcher slept through, and a shorter one would make the watcher
 * pointless while a longer one leaves a miss unnoticed for most of a day.
 */
export const BACKSTOP: { count: number; unit: EveryUnit } = { count: 1, unit: 'hour' }

/**
 * What the settle time is when real time is picked and nothing else says.
 *
 * The same five seconds a new job's own quiet period starts at, and for the same
 * reason: empty is a real setting that means "act on the first event", and
 * copying a folder in produces one event per file, so the answer nobody wants is
 * the one an empty field gives by default. Seeded here rather than left to the
 * person, because the panel appears the moment real time is chosen and a zero
 * sitting in it reads as a considered value.
 */
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
   * Whether this job also reacts to changes as they happen.
   *
   * It is not a switch any more, it is the `live` position in the strip above,
   * and this prop is what stores that position: the expression alone cannot
   * say it, because real time and "every N" write the same backstop. See
   * SCHEDULE_MODES for why the mode moved and what the backstop is for.
   */
  live?: boolean
  onLive?: (next: boolean) => void
  /** How long the tree must go quiet before a change counts as finished. */
  settle?: string
  onSettle?: (next: string) => void
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
   * Real time is the third thing the expression cannot say, and it is stored
   * separately for that reason rather than as a convenience: `@every 1h` on a
   * watching job and `@every 1h` on one that only keeps to the clock are the
   * same string. So the opening mode reads the watch flag first.
   *
   * The stored value is still the single source of truth for the SETTINGS. Only
   * the choice of which picker is open lives here, and it is re-seeded whenever
   * the value changes from outside, so opening another job never shows the last
   * one's mode.
   */
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

  /**
   * Picking a mode, including the one that is not only a mode.
   *
   * Real time is stored in two places at once, the watch flag and the backstop
   * expression, so every OTHER position has to switch the flag back off. A
   * strip whose fifth position turns something on and whose other five leave it
   * alone is a strip that quietly keeps watching a job somebody moved to a
   * nightly schedule.
   */
  function pick(next: ScheduleMode) {
    if (next === 'live') {
      onLive?.(true)
      // The panel that appears has two numbers in it and neither may open at
      // zero: zero seconds of settling means acting on the first event of a
      // copy, which is the one answer nobody wants.
      if (onSettle && (settle ?? '').trim() === '') onSettle(DEFAULT_SETTLE)
      // A backstop of "no schedule" is what the engine refuses outright, so
      // picking real time from "off" seeds one rather than writing a job that
      // cannot be saved. An existing cadence is kept: somebody moving a job
      // from six-hourly to real time did not ask to lose the six hours.
      const seeded =
        state.mode === 'off' || value.trim() === ''
          ? { everyCount: BACKSTOP.count, everyUnit: BACKSTOP.unit }
          : {}
      update({ mode: next, ...seeded })
      return
    }
    onLive?.(false)
    // Entering the cron mode with nothing in the field starts from the
    // schedule that was already set, so the expression is editable rather than
    // empty and invalid.
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
        onChange={pick}
        options={SCHEDULE_MODES.map((m) => ({ value: m, label: t(`schedule.${m}` as const) }))}
      />

      {/* Real time's own two settings, and both of them are here rather than
          three rows further down among the toggles because both answer the
          question the strip above just asked. The settle time is what stops a
          folder of a thousand files becoming a thousand runs; the backstop is
          what notices the event the watcher missed, and the engine refuses a
          watching job without one, so it is shown rather than implied. */}
      {state.mode === 'live' && (
        <div className="flex flex-col gap-3">
          {onSettle && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-carbon-textMuted">
                {t('schedule.settle')}
                {/* Its OWN explanation. The bubble beside this label used to
                    carry `schedule.liveHint`, which explains what real time is
                    rather than what this number does, so the one control on the
                    panel that needed explaining was the one whose (i) answered a
                    different question. jdp: "Rueckfallplan und Beruhigungszeit
                    versteh ich nicht ganz, wofuer man das braucht." */}
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
            {/* Each day takes its own position in the palette, the way every
                other multi-part control in the app does. They all carried the
                single accent, so with the rainbow on a row of seven read as one
                colour where the same row in the other app reads as seven. That
                is the same gap the selectors had. */}
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

/**
 * How many, and of what. One component, two places.
 *
 * The cadence panel and the backstop panel ask the identical question, and
 * written out twice they would answer it with two number boxes that drift apart
 * at the first change to either.
 */
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
      {/* A dropdown, not a four-segment strip (jdp: "Selektor in ein dropdown
          umwandeln, ebenso bei alle N"). A strip is for a choice worth showing
          in full, and four units spelled out beside a number box took most of a
          form column to say one word. The same fixed 8rem column the quiet
          period's unit picker uses, so the two rows that ask the same question
          are the same shape. */}
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
