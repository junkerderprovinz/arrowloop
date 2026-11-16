import { describe, expect, it } from 'vitest'

import { dateLocale, regionOf } from './dateLocale'

const nov3 = new Date(2026, 10, 3, 14, 5)
const numeric = { day: '2-digit', month: '2-digit', year: 'numeric' } as const

describe('dateLocale', () => {
  it('writes an English date day first on a British device', () => {
    expect(nov3.toLocaleDateString(dateLocale('en', 'GB'), numeric)).toBe('03/11/2026')
  })

  it('writes an English date month first on an American device', () => {
    expect(nov3.toLocaleDateString(dateLocale('en', 'US'), numeric)).toBe('11/03/2026')
  })

  it('keeps the words of the app language in another region', () => {
    expect(nov3.toLocaleDateString(dateLocale('de', 'GB'), { month: 'long' })).toBe('November')
    expect(nov3.toLocaleDateString(dateLocale('fr', 'GB'), { weekday: 'long' })).toBe('mardi')
  })

  it('takes the hours from the region', () => {
    expect(nov3.toLocaleTimeString(dateLocale('en', 'GB'), { hour: '2-digit', minute: '2-digit' })).toBe('14:05')
  })

  it('is the bare language where the device names no region', () => {
    expect(dateLocale('en', null)).toBe('en')
    expect(dateLocale('en', '')).toBe('en')
  })

  it('is the bare language for a region it cannot read', () => {
    expect(dateLocale('en', 'not a region')).toBe('en')
  })
})

describe('regionOf', () => {
  it('reads the region of a language tag', () => {
    expect(regionOf('en-GB')).toBe('GB')
    expect(regionOf('zh-Hant-TW')).toBe('TW')
    expect(regionOf('es-419')).toBe('419')
    expect(regionOf('en_gb')).toBe('GB')
  })

  it('is null for a tag without one', () => {
    expect(regionOf('de')).toBeNull()
    expect(regionOf(undefined)).toBeNull()
  })
})
