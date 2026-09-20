import { useMemo } from 'react'

import { Choice, NumberField } from './Field'
import { useT } from '../lib/i18n'

/**
 * The quiet period, edited as a number and a unit and stored as the Go
 * duration string the engine parses. It is how long a folder must stop
 * changing before a watched job acts, so days are not offered.
 */

export type QuietUnit = 's' | 'm' | 'h'

const UNITS: QuietUnit[] = ['s', 'm', 'h']

/**
 * A new job's quiet period. Without one, a watched job acts on the first of
 * the many events a folder copy produces; five seconds lets a file manager
 * finish writing. Clearing the field still means zero.
 */
export const DEFAULT_QUIET = '5s'

/**
 * A duration string split into a number and a unit.
 *
 * Text it cannot read comes back as zero seconds rather than an error, since
 * the box is edited character by character. A compound duration ("1m30s")
 * keeps its total in the largest unit that loses nothing (90s).
 */
export function readQuiet(value: string): { amount: number; unit: QuietUnit } {
  const text = value.trim()
  if (text === '') return { amount: 0, unit: 's' }

  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(h|m|s)/g)]
  if (parts.length === 0) {
    // Go rejects a bare number, but whoever typed it means seconds.
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
      <NumberField
        value={amount}
        min={0}
        onChange={(next) => onChange(writeQuiet(next, unit))}
        label={t('edit.quietPeriod')}
      />
      {/* A fixed width that fits the longest unit name in every measured
          locale, so the row keeps its shape on every page. */}
      <div className="w-32 shrink-0">
        <Choice<QuietUnit>
          value={unit}
          label={t('edit.quietUnit')}
          // Changing the unit keeps the number: 5 seconds switched to minutes
          // is 5 minutes, not 0.08.
          onChange={(next) => onChange(writeQuiet(amount, next))}
          options={UNITS.map((u) => ({ value: u, label: t(`edit.quiet.${u}` as const) }))}
        />
      </div>
    </div>
  )
}
