// The raw-expression mode starts empty, and an empty expression means no
// schedule, so a picker that derived its mode from the value would jump back to
// "off" as soon as cron is chosen. Both pickers keep the mode in component
// state instead, and the round trip of an empty cron is expected to lose it.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_SCHEDULE, buildSchedule, parseSchedule } from './schedule.data'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_SCHEDULE = resolve(HERE, '..', 'components', 'Schedule.tsx')
const PHONE_SCHEDULE = resolve(HERE, '..', '..', '..', 'mobile', 'src', 'screens', 'JobEdit.tsx')

describe('the schedule expression', () => {
  it('carries every mode that has something to say, straight through', () => {
    const cases = [
      { ...DEFAULT_SCHEDULE, mode: 'off' as const },
      { ...DEFAULT_SCHEDULE, mode: 'every' as const, everyCount: 6, everyUnit: 'hour' as const },
      { ...DEFAULT_SCHEDULE, mode: 'daily' as const, time: '03:00' },
      { ...DEFAULT_SCHEDULE, mode: 'weekly' as const, time: '03:00', days: [1, 5] },
      { ...DEFAULT_SCHEDULE, mode: 'cron' as const, cron: '15 2 * * 1-5' },
    ]
    for (const state of cases) {
      expect(parseSchedule(buildSchedule(state)).mode).toBe(state.mode)
    }
  })

  it('writes nothing for an empty raw expression', () => {
    const empty = { ...DEFAULT_SCHEDULE, mode: 'cron' as const, cron: '' }
    // A placeholder expression would give the job a schedule nobody set.
    expect(buildSchedule(empty)).toBe('')
    expect(parseSchedule(buildSchedule(empty)).mode).toBe('off')
  })
})

describe('both schedule pickers', () => {
  // A source check, since no renderer in this suite can mount the phone's screen.
  const surfaces = [
    ['the container', WEB_SCHEDULE],
    ['the phone', PHONE_SCHEDULE],
  ] as const

  for (const [what, path] of surfaces) {
    it(`keeps ${what}'s mode in component state, not derived from the value`, () => {
      const source = readFileSync(path, 'utf8')
      expect(source).toMatch(/useState<ScheduleMode>/)
      // Re-seeded when the value changes from outside, or opening a second job
      // shows the first one's picker.
      expect(source).toMatch(/setMode\(/)
    })
  }
})
