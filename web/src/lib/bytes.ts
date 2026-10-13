const STEPS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

/**
 * A byte count in the units a person reads.
 *
 * Binary steps, as file managers use, with the short suffixes rather than
 * KiB/MiB. One decimal below 10 and none above, so the width stays roughly
 * constant in a list. With a language the number is written its way, such as
 * 2,5 GB in German.
 */
export function bytes(n: number, lang?: string): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  let value = n
  let step = 0
  while (value >= 1024 && step < STEPS.length - 1) {
    value /= 1024
    step++
  }
  const digits = step > 0 && value < 10 ? 1 : 0
  const shown = lang
    ? new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
    : value.toFixed(digits)
  return `${shown} ${STEPS[step]}`
}
