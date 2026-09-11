import type { TranslationKey } from './i18n.data'

/**
 * How long ago something happened, as a number and a unit KEY.
 *
 * A stamp on its own is a number somebody has to subtract from today, and the
 * question a "last run" line answers is "is this thing keeping up". So it is
 * said the way somebody would say it out loud: two days, three hours.
 *
 * It returns the unit as a translation key rather than a word, which is the
 * whole reason this file exists. The phone had its own version that returned
 * `"just now"`, `"3 h"` and `"2 d"` as English literals, and the card wrapped
 * them in translated text - so a German screen read "zuletzt just now her",
 * which is neither a language nor a sentence. Measured on the device.
 *
 * Always PLURAL, and that is deliberate rather than sloppy. Carrying singular
 * and plural forms looks more correct and is less so: a language whose rules
 * select "few" or "many" would fall through to English at the commonest counts,
 * and the number is right there beside the word either way.
 */
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
