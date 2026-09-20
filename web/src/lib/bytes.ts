const STEPS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

/**
 * A byte count in the units a person reads.
 *
 * Binary steps, as file managers use, with the short suffixes rather than
 * KiB/MiB. One decimal below 10 and none above, so the width stays roughly
 * constant in a list.
 */
export function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  let value = n
  let step = 0
  while (value >= 1024 && step < STEPS.length - 1) {
    value /= 1024
    step++
  }
  if (step === 0) return `${Math.round(value)} B`
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${STEPS[step]}`
}
