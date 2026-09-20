import { describe, expect, it } from 'vitest'

import { readQuiet, writeQuiet } from './QuietPeriod'

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
    expect(readQuiet('5')).toEqual({ amount: 5, unit: 's' })
  })

  it('keeps the total of a compound duration rather than its first part', () => {
    expect(readQuiet('1m30s')).toEqual({ amount: 90, unit: 's' })
    expect(readQuiet('2h30m')).toEqual({ amount: 150, unit: 'm' })
    expect(readQuiet('1h0m0s')).toEqual({ amount: 1, unit: 'h' })
  })

  it('falls back rather than blanking on something it cannot read', () => {
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
    // Empty leaves the quiet period unset, where "0s" would ask to wait for
    // nothing.
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
