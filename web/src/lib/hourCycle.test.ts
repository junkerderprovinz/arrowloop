import { describe, expect, it } from 'vitest'

import { hourCycle } from './hourCycle'

const afternoon = new Date(2026, 10, 9, 14, 40)
const midnight = new Date(2026, 10, 9, 0, 5)
const time = (at: Date, lang: string, uses24: boolean | null) =>
  at.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', ...hourCycle(uses24) })

describe('hourCycle', () => {
  it('reads English on a 24-hour phone as 14:40', () => {
    expect(time(afternoon, 'en', true)).toBe('14:40')
  })

  it('starts the day at 00 on a 24-hour phone', () => {
    expect(time(midnight, 'en', true)).toBe('00:05')
  })

  it('gives German on a 12-hour phone its afternoon mark', () => {
    expect(time(afternoon, 'de', false)).toMatch(/^02:40\s?PM$/)
  })

  it('leaves the language its own habit when the phone does not say', () => {
    expect(time(afternoon, 'en', null)).toMatch(/^02:40\s?PM$/)
    expect(time(afternoon, 'de', null)).toBe('14:40')
  })
})
