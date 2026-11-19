import { describe, expect, it } from 'vitest'

import { minAgeChoice, minAgeDays } from './minAge.data'

describe('the minimum age a job shows', () => {
  it('is off for a job that sends every file', () => {
    expect(minAgeChoice(undefined, false)).toBe('off')
    expect(minAgeChoice(0, false)).toBe('off')
  })

  it('names a preset by its days', () => {
    expect(minAgeChoice(7, false)).toBe('7')
    expect(minAgeChoice(120, false)).toBe('120')
  })

  it('is custom for any other number, or once somebody picked it', () => {
    expect(minAgeChoice(14, false)).toBe('custom')
    expect(minAgeChoice(30, true)).toBe('custom')
  })
})

describe('the days a choice writes', () => {
  it('writes nothing for off, so the job sends every file', () => {
    expect(minAgeDays('off', 30)).toBeUndefined()
  })

  it('writes a preset as its days', () => {
    expect(minAgeDays('60', 0)).toBe(60)
  })

  it('keeps the days in force when somebody switches to custom', () => {
    expect(minAgeDays('custom', 30)).toBe(30)
    expect(minAgeDays('custom', 0)).toBe(14)
  })
})
