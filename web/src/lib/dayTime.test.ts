import { describe, expect, it } from 'vitest'

import { dayTime } from './dayTime'

const now = new Date(2026, 9, 12, 9, 0)
const en = ({ day, time }: { day: string; time: string }) => `${day}, ${time}`
const de = ({ day, time }: { day: string; time: string }) => `${day}, ${time} Uhr`

describe('dayTime', () => {
  it('names today and yesterday', () => {
    expect(dayTime(new Date(2026, 9, 12, 3, 51), 'en-GB', en, now)).toBe('Today, 03:51')
    expect(dayTime(new Date(2026, 9, 11, 3, 48), 'de', de, now)).toBe('Gestern, 03:48 Uhr')
  })

  it('spells out a day of the last week', () => {
    expect(dayTime(new Date(2026, 9, 7, 4, 10), 'en-GB', en, now)).toBe('Wednesday, 04:10')
    expect(dayTime(new Date(2026, 9, 7, 4, 10), 'de', de, now)).toBe('Mittwoch, 04:10 Uhr')
  })

  it('keeps the digits of an older date', () => {
    expect(dayTime(new Date(2026, 8, 28, 3, 46), 'de', de, now)).toBe('28.09., 03:46 Uhr')
  })
})
