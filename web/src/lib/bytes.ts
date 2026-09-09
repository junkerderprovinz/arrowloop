/**
 * A byte count in the units a person reads.
 *
 * Binary steps (1024), because this measures what a disk actually holds and
 * every file manager somebody compares the number against uses the same steps.
 * The unit suffixes are deliberately the short SI-looking ones rather than
 * KiB/MiB: this is a number in a sentence, not a specification, and the
 * pedantically correct form reads as a typo to most people looking at it.
 *
 * One decimal below 10 and none above, so the width stays roughly constant in a
 * list: "9.4 GB" and "312 MB" are the same amount of information and nearly the
 * same amount of space, where "9.4 GB" beside "312.0 MB" is neither.
 */
const STEPS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

export function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  let value = n
  let step = 0
  while (value >= 1024 && step < STEPS.length - 1) {
    value /= 1024
    step++
  }
  // Whole bytes never get a decimal: "512.0 B" is noise.
  if (step === 0) return `${Math.round(value)} B`
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${STEPS[step]}`
}
