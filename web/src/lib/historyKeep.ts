// historyKeep is a Go duration, which has no unit for days, and the settings
// show it in days.

/** What the engine keeps when historyKeep is empty or cannot be read. */
const DEFAULT_DAYS = 90

const UNIT_SECONDS: Record<string, number> = { h: 3600, m: 60, s: 1, ms: 1e-3, us: 1e-6, µs: 1e-6, ns: 1e-9 }

/** The days historyKeep keeps a run for, read the way the engine reads it. Zero keeps every run. */
export function keepDays(raw: string | undefined): number {
  const text = (raw ?? '').trim()
  if (text === '') return DEFAULT_DAYS
  if (text === '0') return 0
  const parts = [...text.matchAll(/(\d+(?:\.\d+)?)(h|ms|us|µs|ns|m|s)/g)]
  if (parts.map((p) => p[0]).join('') !== text) return DEFAULT_DAYS
  const seconds = parts.reduce((sum, [, n, unit]) => sum + Number(n) * UNIT_SECONDS[unit!]!, 0)
  if (seconds === 0) return 0
  return Math.max(1, Math.round(seconds / 86400))
}

/** historyKeep for a number of days. */
export function keepSetting(days: number): string {
  return days <= 0 ? '0' : `${days * 24}h`
}
