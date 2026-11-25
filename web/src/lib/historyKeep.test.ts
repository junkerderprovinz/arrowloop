import { describe, expect, it } from 'vitest'

import { keepDays, keepSetting } from './historyKeep'

describe('how long the run log keeps a run', () => {
  it.each([
    ['nothing set', undefined, 90],
    ['an empty value', '', 90],
    ['thirty days', '720h', 30],
    ['a duration as Go writes it', '2160h0m0s', 90],
    ['every run', '0', 0],
    ['every run, written as a duration', '0s', 0],
    ['less than a day', '90m', 1],
    ['a typo, which the engine reads as ninety days', '30d', 90],
  ])('reads %s as days', (_name, raw, days) => {
    expect(keepDays(raw)).toBe(days)
  })

  it('writes days in hours, since a Go duration has no days', () => {
    expect(keepSetting(14)).toBe('336h')
  })

  it('writes zero days as keeping every run', () => {
    expect(keepSetting(0)).toBe('0')
  })
})
