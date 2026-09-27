// No React and no api types, so the phone app can share it.

const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const
const SHORT = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/**
 * A transfer speed in bytes a second, as "12,4 MB/s" in the reader's language.
 * Binary steps with one decimal below 10, like bytes() in bytes.ts, so a file's
 * size and the speed it moves at read on one scale. Intl spells the unit the
 * reader's way, "Mo/s" in French; a runtime that cannot format units gets the
 * short ones.
 */
export function speed(perSecond: number, lang: string): string {
  let value = Math.max(0, perSecond)
  let step = 0
  while (value >= 1024 && step < UNITS.length - 1) {
    value /= 1024
    step++
  }
  const digits = step > 0 && value < 10 ? 1 : 0
  const figures = { minimumFractionDigits: digits, maximumFractionDigits: digits }
  const plain = new Intl.NumberFormat(lang, figures).format(value)
  try {
    const unit = new Intl.NumberFormat(lang, {
      ...figures,
      style: 'unit',
      unit: `${UNITS[step]}-per-second`,
      unitDisplay: 'short',
    }).format(value)
    // Hermes on Android can ignore the unit rather than refuse it.
    if (unit !== plain) return unit
  } catch {
    // An engine without unit formatting throws a RangeError.
  }
  return `${plain} ${SHORT[step]}/s`
}
