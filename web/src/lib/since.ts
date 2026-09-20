import type { TranslationKey } from './i18n.data'

const UNITS: [number, TranslationKey][] = [
  [60, 'time.second'],
  [60, 'time.minute'],
  [24, 'time.hour'],
  [365, 'time.day'],
]

export interface Since {
  /** Whole units, already floored. */
  count: number
  unit: TranslationKey
}

/**
 * How long ago something happened, as a count and a unit's translation key, so
 * both the browser and the phone can put it into a translated sentence.
 *
 * The unit is always the plural key: languages with "few" and "many" rules
 * would otherwise fall through to English at the commonest counts.
 */
export function since(when: string, now: number = Date.now()): Since {
  const then = new Date(when).getTime()
  let value = Math.max(0, (now - then) / 1000)
  let unit: TranslationKey = 'time.second'
  for (const [size, name] of UNITS) {
    if (value < size) {
      unit = name
      break
    }
    value /= size
    unit = name
  }
  return { count: Math.floor(value), unit }
}
