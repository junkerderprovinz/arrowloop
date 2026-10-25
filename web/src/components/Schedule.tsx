import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import { hueVars } from '../lib/appearance'

import { Selector } from './Selector'
import { Choice, NumberField, Text } from './Field'
import { Held } from './GlobalValues'
import { QuietPeriod } from './QuietPeriod'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { TimePicker } from './TimePicker'
// The parsing lives in lib because the phone reads schedules too.
import {
  EVERY_UNITS,
  SCHEDULE_MODES,
  WEEKDAYS,
  buildSchedule,
  chooseKind,
  parseSchedule,
  type EveryUnit,
  type ScheduleMode,
  type ScheduleState,
} from '../lib/schedule.data'
import { useT } from '../lib/i18n'

/** The fields a schedule writes on a job. A default schedule writes only the expression. */
export type SchedulePatch = {
  schedule: string
  watch?: boolean
  watchSettle?: string
}

/**
 * A schedule, built with a selector of kinds and the fields of the chosen one,
 * and stored as the expression the engine reads. An expression the fields
 * cannot say opens as cron, verbatim, rather than being simplified.
 *
 * The kind is held rather than derived from the expression, which cannot tell
 * cron from the daily schedule it was seeded with, "every 24h" from daily, or
 * real time from "every N". It is seeded again whenever the value changes from
 * outside, so another job never opens in the last one's kind.
 */
export function useSchedule({
  value,
  watch = false,
  settle = '',
  realTime = false,
  onChange,
}: {
  value: string
  /** Whether the job watches for changes, which the expression cannot say. */
  watch?: boolean
  /** How long the tree must go quiet before a change counts as finished. */
  settle?: string
  /** Offers real time, which belongs to a job; a default schedule has nobody to watch for. */
  realTime?: boolean
  onChange: (next: SchedulePatch) => void
}) {
  const derived = parseSchedule(value)
  const [mode, setMode] = useState<ScheduleMode>(watch ? 'live' : derived.mode)
  // The expression as typed, since the stored one is trimmed and a space
  // between two fields would vanish as it is typed.
  const [cron, setCron] = useState(value)
  const seen = useRef(value)
  useEffect(() => {
    if (seen.current !== value) {
      seen.current = value
      setMode(watch ? 'live' : parseSchedule(value).mode)
      setCron(value)
    }
  }, [value, watch])

  const state: ScheduleState = { ...derived, mode }

  function write(next: SchedulePatch) {
    seen.current = next.schedule
    onChange(next)
  }

  return {
    state,
    cron,
    settle,
    kinds: realTime ? SCHEDULE_MODES : SCHEDULE_MODES.filter((m) => m !== 'live'),
    update(patch: Partial<ScheduleState>) {
      write({ schedule: buildSchedule({ ...state, ...patch }) })
    },
    pick(next: ScheduleMode) {
      const choice = chooseKind(state, value, settle, next)
      setMode(next)
      if (next === 'cron') setCron(choice.state.cron)
      write({
        schedule: choice.schedule,
        ...(realTime ? { watch: choice.watch } : {}),
        ...(choice.settle !== undefined ? { watchSettle: choice.settle } : {}),
      })
    },
    type(text: string) {
      setCron(text)
      write({ schedule: buildSchedule({ ...state, cron: text }) })
    },
    setSettle(next: string) {
      write({ schedule: value, watchSettle: next })
    },
  }
}

export type ScheduleEditor = ReturnType<typeof useSchedule>

/**
 * The kinds as one bar. Across a card every segment is as wide as the widest;
 * at the end of a settings row it hugs its segments like the selectors beside
 * it.
 */
export function ScheduleKinds({ editor, hug = false, hue }: { editor: ScheduleEditor; hug?: boolean; hue?: number }) {
  const { t } = useT()
  return (
    <Selector<ScheduleMode>
      scale={hug ? 'small' : 'big'}
      low
      hug={hug}
      hue={hue}
      label={t('edit.schedule')}
      value={editor.state.mode}
      onChange={editor.pick}
      options={editor.kinds.map((m) => ({ value: m, label: t(`schedule.${m}` as const) }))}
    />
  )
}

/**
 * The fields of the chosen kind, one setting to a line, each held on its own
 * like the rows beside it. A schedule that never runs by itself has none.
 */
export function ScheduleDetails({
  editor,
  held = false,
  onHeld = () => undefined,
}: {
  editor: ScheduleEditor
  held?: boolean
  onHeld?: () => void
}) {
  const { t } = useT()
  const { state } = editor

  function toggleDay(day: number) {
    const next = state.days.includes(day) ? state.days.filter((d) => d !== day) : [...state.days, day]
    // No days would silently mean daily.
    if (next.length === 0) return
    editor.update({ days: next })
  }

  switch (state.mode) {
    case 'off':
      return null
    case 'every':
      return (
        <DetailRow held={held} onHeld={onHeld} label={t('schedule.everyLabel')}>
          <EveryPicker state={state} update={editor.update} />
        </DetailRow>
      )
    case 'daily':
      return (
        <DetailRow held={held} onHeld={onHeld} label={t('schedule.at')}>
          <TimePicker value={state.time} label={t('schedule.at')} onChange={(time) => editor.update({ time })} />
        </DetailRow>
      )
    case 'weekly':
      return (
        <>
          <DetailRow held={held} onHeld={onHeld} label={t('schedule.days')}>
            <div className="glim-well flex flex-wrap gap-[0.2rem] p-[0.2rem]" style={{ borderRadius: 'var(--radius-pill)' }}>
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
          </DetailRow>
          <DetailRow held={held} onHeld={onHeld} label={t('schedule.at')}>
            <TimePicker value={state.time} label={t('schedule.at')} onChange={(time) => editor.update({ time })} />
          </DetailRow>
        </>
      )
    case 'live':
      return (
        <>
          <DetailRow held={held} onHeld={onHeld} label={t('schedule.settle')} hint={t('schedule.settleHint')}>
            <QuietPeriod value={editor.settle} onChange={editor.setSettle} />
          </DetailRow>
          <DetailRow held={held} onHeld={onHeld} label={t('schedule.backstop')} hint={t('schedule.backstopHint')}>
            <EveryPicker state={state} update={editor.update} />
          </DetailRow>
        </>
      )
    case 'cron':
      return (
        <Held block held={held} onHeld={onHeld}>
          <Text value={editor.cron} onChange={editor.type} placeholder="0 */6 * * *" label={t('schedule.cron')} mono />
        </Held>
      )
  }
}

/** One setting on a line, as in a settings card: its name at the start, its control at the end. */
function DetailRow({
  label,
  hint,
  held,
  onHeld,
  children,
}: {
  label: string
  hint?: string
  held: boolean
  onHeld: () => void
  children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
      <span className="flex min-w-0 flex-[1_1_12.5rem] items-center gap-1.5 text-body text-carbon-text">
        {label}
        {hint && <InfoBubble tip={hint} />}
      </span>
      <Held held={held} onHeld={onHeld}>
        <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{children}</div>
      </Held>
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
