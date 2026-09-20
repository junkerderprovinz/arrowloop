import { describe, expect, it } from 'vitest'

import { NEEDED, NO_STREAK, WINDOW, press, type Streak } from './tapStreak'

// The window has to fit a person, who presses about half a second apart or
// slower, not a script that clicks five times in one millisecond.

/** Press n times at a fixed interval, starting from quiet. */
function run(times: number, interval: number, from: Streak = NO_STREAK): boolean {
  let streak = from
  let at = 10_000
  let fired = false
  for (let i = 0; i < times; i++) {
    const step = press(streak, at)
    streak = step.next
    fired = fired || step.fired
    at += interval
  }
  return fired
}

describe('a run of presses on one control', () => {
  it.each([0, 120, 300, 500, 700, 900, 1100])('fires at %ims between presses', (gap) => {
    expect(run(NEEDED, gap)).toBe(true)
  })

  it('gives up when the presses stop being a run', () => {
    // Past the window, each press starts over.
    expect(run(NEEDED, WINDOW + 50)).toBe(false)
    expect(run(NEEDED, 4000)).toBe(false)
  })

  it('needs the full count', () => {
    expect(run(NEEDED - 1, 300)).toBe(false)
  })

  // A floor, so the window cannot be tightened towards a reflex test.
  it('leaves enough room for an unhurried hand', () => {
    expect(WINDOW).toBeGreaterThanOrEqual(1000)
    expect(NEEDED * WINDOW).toBeGreaterThanOrEqual(5000)
  })

  it('starts a fresh run after one completes, rather than firing on every press after the fifth', () => {
    let streak = NO_STREAK
    let at = 10_000
    const fires: number[] = []
    // Twelve steady presses: two complete runs.
    for (let i = 0; i < 12; i++) {
      const step = press(streak, at)
      streak = step.next
      if (step.fired) fires.push(i)
      at += 400
    }
    expect(fires).toEqual([4, 9])
  })

  it('does not accumulate across an afternoon of ordinary clicks', () => {
    // The button navigates, so it gets pressed for its own sake.
    expect(run(20, 30_000)).toBe(false)
  })
})
