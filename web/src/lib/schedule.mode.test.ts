// ---------------------------------------------------------------------------
// The mode a schedule expression cannot say, and who has to remember it.
//
// Both surfaces build a cron expression from a small state object and read it
// back to decide which picker is open. That works for every mode but one: the
// raw-expression mode starts EMPTY, an empty expression means "no schedule",
// and so a picker that re-derives its mode on every render jumps straight back
// to "off" the moment somebody chooses it. Reported twice, from both ends:
//
//   - the container, where switching to cron seeded the field from the
//     schedule already set, so "0 3 * * *" read back as "daily"
//   - the phone, where it seeded from nothing: "cron geht nicht. es kommt kein
//     feld zum einstellen"
//
// One cause: a builder whose only memory is its own output cannot hold a state
// that output does not yet describe. The fix is that the MODE lives in
// component state on both surfaces, and this file is what keeps it there.
//
// The data half is tested here because it is the tempting wrong fix: making
// `buildSchedule` emit a placeholder like "0 * * * *" for an empty cron would
// make the round trip work and would quietly give a job an hourly schedule
// nobody asked for. So the round trip is asserted to FAIL, on purpose.
// ---------------------------------------------------------------------------
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

  it('cannot carry an EMPTY raw expression, and must not pretend to', () => {
    const empty = { ...DEFAULT_SCHEDULE, mode: 'cron' as const, cron: '' }
    // Nothing is written, which is correct: a job whose expression is blank
    // has no schedule. Inventing one here would hand somebody an hourly job
    // they never asked for, on a screen they were only looking at.
    expect(buildSchedule(empty)).toBe('')
    // And therefore the mode does not survive the round trip. This is the
    // whole reason both pickers hold their mode themselves.
    expect(parseSchedule(buildSchedule(empty)).mode).toBe('off')
  })
})

describe('both schedule pickers', () => {
  // A source check rather than a behaviour one, because no renderer in this
  // suite can mount the phone's screen - and the bug lived only on the phone
  // for a round precisely because nothing here could see it. A guard that
  // cannot reach a surface reports nothing about it.
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
