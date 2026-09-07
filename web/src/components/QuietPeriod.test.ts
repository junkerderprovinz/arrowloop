import { describe, expect, it } from 'vitest'

import { readQuiet, writeQuiet } from './QuietPeriod'

/**
 * The quiet period is stored as a Go duration and edited as a number plus a
 * unit, so something has to translate between the two, and that translation is
 * where a settings control quietly loses somebody's value.
 *
 * The cases below are the ones that actually bite: a field being typed into
 * character by character, a compound duration nobody can express with two
 * controls, and a stored value written by hand rather than by this control.
 */

describe('reading a stored duration', () => {
  it.each([
    ['30s', 30, 's'],
    ['5m', 5, 'm'],
    ['1h', 1, 'h'],
    ['  10m  ', 10, 'm'],
  ])('reads %s', (text, amount, unit) => {
    expect(readQuiet(text)).toEqual({ amount, unit })
  })

  it('reads a bare number as seconds', () => {
    // Go would reject "5" outright, but somebody typing it into a box labelled
    // "quiet period" means five seconds, and refusing to show anything is a
    // worse answer than showing what they meant.
    expect(readQuiet('5')).toEqual({ amount: 5, unit: 's' })
  })

  it('keeps the total of a compound duration rather than its first part', () => {
    // Two controls cannot say "1m30s". Rewriting it as "1m" would silently
    // throw away thirty seconds of somebody's setting, so it becomes 90s: the
    // same duration, in the smallest unit that loses nothing.
    expect(readQuiet('1m30s')).toEqual({ amount: 90, unit: 's' })
    expect(readQuiet('2h30m')).toEqual({ amount: 150, unit: 'm' })
    expect(readQuiet('1h0m0s')).toEqual({ amount: 1, unit: 'h' })
  })

  it('falls back rather than blanking on something it cannot read', () => {
    // The box is edited character by character. A field that emptied itself
    // whenever the text was briefly unparseable would be unusable.
    expect(readQuiet('')).toEqual({ amount: 0, unit: 's' })
    expect(readQuiet('later')).toEqual({ amount: 0, unit: 's' })
  })
})

describe('writing one back', () => {
  it('writes what the engine parses', () => {
    expect(writeQuiet(30, 's')).toBe('30s')
    expect(writeQuiet(5, 'm')).toBe('5m')
    expect(writeQuiet(1, 'h')).toBe('1h')
  })

  it('writes nothing at all for zero', () => {
    // Empty means "the default", which is what an unset quiet period is. A
    // literal "0s" would be a deliberate instruction to wait for nothing.
    expect(writeQuiet(0, 's')).toBe('')
    expect(writeQuiet(-1, 'm')).toBe('')
    expect(writeQuiet(Number.NaN, 'h')).toBe('')
  })

  it('survives a round trip in every unit', () => {
    for (const unit of ['s', 'm', 'h'] as const) {
      for (const amount of [1, 7, 45, 3600]) {
        expect(readQuiet(writeQuiet(amount, unit))).toEqual({ amount, unit })
      }
    }
  })
})
