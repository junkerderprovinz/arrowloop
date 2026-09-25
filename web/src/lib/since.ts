const UNITS: [number, Intl.RelativeTimeFormatUnit][] = [
  [60, 'second'],
  [60, 'minute'],
  [24, 'hour'],
  [365, 'day'],
]

export interface Since {
  /** Whole units, already floored. */
  count: number
  unit: Intl.RelativeTimeFormatUnit
}

/**
 * How long ago something happened, in the largest unit it fills, for
 * Intl.RelativeTimeFormat, which knows every language's plural forms.
 */
export function since(when: string, now: number = Date.now()): Since {
  let value = Math.max(0, (now - new Date(when).getTime()) / 1000)
  for (const [size, unit] of UNITS) {
    if (value < size) return { count: Math.floor(value), unit }
    value /= size
  }
  return { count: Math.floor(value), unit: 'year' }
}
