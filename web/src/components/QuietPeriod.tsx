import { useMemo } from 'react'

import { Choice, NumberField } from './Field'
import { useT } from '../lib/i18n'

/**
 * The quiet period: a number and the unit it is counted in.
 *
 * It used to be one text box with a `5s` placeholder, which is the shape of a
 * field that knows the answer and will not say it. jdp: "ruhezeit: ist voellig
 * unklar was man da wie einstellen soll." A duration written as text asks
 * somebody to guess a syntax, and the guesses that fail ("5 sec", "5 Sekunden",
 * "00:00:05") fail silently as far as the box is concerned.
 *
 * Two controls answer both halves of that: how many, and of what. The stored
 * value stays a Go duration string, because that is what the engine parses and
 * what somebody editing the file by hand will see.
 *
 * Seconds, minutes and hours, and no days. A quiet period is how long a folder
 * has to stop changing before a watched job believes the writing is over; the
 * useful range is seconds to minutes, hours is already generous, and a "days"
 * entry would only be there to make the list look complete.
 */

export type QuietUnit = 's' | 'm' | 'h'

const UNITS: QuietUnit[] = ['s', 'm', 'h']

/**
 * A duration string split into a number and a unit.
 *
 * Anything this cannot read comes back as the default rather than as an error,
 * because the box is edited character by character: "1" is a perfectly good
 * thing to have typed on the way to "10m", and a field that blanked itself
 * every time the text was briefly unparseable would be unusable.
 *
 * A compound Go duration ("1m30s") is read by its LARGEST unit and its total,
 * so it survives a round trip in the only way two controls can represent it:
 * 90s. Rewriting it as "1m" would silently drop the thirty seconds.
 */
export function readQuiet(value: string): { amount: number; unit: QuietUnit } {
  const text = value.trim()
  if (text === '') return { amount: 0, unit: 's' }

  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(h|m|s)/g)]
  if (parts.length === 0) {
    // A bare number with no unit at all. Go would reject it, and the person
    // typing it almost certainly means seconds.
    const bare = Number(text)
    if (Number.isFinite(bare) && bare >= 0) return { amount: Math.round(bare), unit: 's' }
    return { amount: 0, unit: 's' }
  }

  const seconds = parts.reduce((total, [, n, u]) => {
    const scale = u === 'h' ? 3600 : u === 'm' ? 60 : 1
    return total + Number(n) * scale
  }, 0)

  if (parts.length === 1) {
    const unit = parts[0][2] as QuietUnit
    return { amount: Math.round(Number(parts[0][1])), unit }
  }
  // Compound: keep the total, in the smallest unit that loses nothing.
  if (seconds % 3600 === 0) return { amount: seconds / 3600, unit: 'h' }
  if (seconds % 60 === 0) return { amount: seconds / 60, unit: 'm' }
  return { amount: Math.round(seconds), unit: 's' }
}

/** The duration string for a number and a unit. Zero means no quiet period. */
export function writeQuiet(amount: number, unit: QuietUnit): string {
  if (!Number.isFinite(amount) || amount <= 0) return ''
  return `${Math.round(amount)}${unit}`
}

export function QuietPeriod({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const { t } = useT()
  const { amount, unit } = useMemo(() => readQuiet(value), [value])

  return (
    <div className="flex items-center gap-2">
      {/* The steppers come from the design language's own file, which is also
          where the wheel lives: the field answers it while it has focus, so a
          value being dialled in needs neither the keyboard nor a click. That is
          GlimStone 1.7.4, added for this and available to every number field in
          the app at the same time. */}
      <NumberField
        value={amount}
        min={0}
        onChange={(next) => onChange(writeQuiet(next, unit))}
        label={t('edit.quietPeriod')}
      />
      <div className="min-w-0 flex-1">
        <Choice<QuietUnit>
          value={unit}
          label={t('edit.quietUnit')}
          // Changing the unit keeps the NUMBER rather than the duration. "5
          // seconds" switched to minutes means five minutes, which is what the
          // control looks like it is doing; converting to 0.08 minutes would be
          // arithmetically honest and would silently ruin the setting.
          onChange={(next) => onChange(writeQuiet(amount, next))}
          options={UNITS.map((u) => ({ value: u, label: t(`edit.quiet.${u}` as const) }))}
        />
      </div>
    </div>
  )
}
