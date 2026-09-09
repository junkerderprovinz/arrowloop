import { describe, expect, it } from 'vitest'

import { NEEDED, NO_STREAK, WINDOW, press, type Streak } from './tapStreak'

/**
 * The window has to fit a HAND, and that is the whole point of this file.
 *
 * The easter egg this counts for shipped with a 600ms window, verified by a
 * script clicking five times in the same millisecond. That proved the streak
 * works at zero interval, which is the one interval no person ever produces:
 * pressing on purpose runs closer to half a second per press, and each press
 * here visibly changes the page, which invites a pause. So it reset under every
 * real hand and the feature existed for the test alone. jdp: "das easter egg
 * geht nicht."
 *
 * These pass the times in, so the intervals under test are the ones people
 * actually make rather than the ones a loop happens to produce.
 */

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
  // The numbers a person actually makes. 500ms is unhurried, 900ms is somebody
  // watching the page change between presses, and both have to work.
  it.each([0, 120, 300, 500, 700, 900, 1100])('fires at %ims between presses', (gap) => {
    expect(run(NEEDED, gap)).toBe(true)
  })

  it('gives up when the presses stop being a run', () => {
    // Past the window, so each press starts over and the fifth is still a first.
    expect(run(NEEDED, WINDOW + 50)).toBe(false)
    expect(run(NEEDED, 4000)).toBe(false)
  })

  it('needs the full count', () => {
    expect(run(NEEDED - 1, 300)).toBe(false)
  })

  /**
   * The window is not just "some number that passes the cases above": it has to
   * be comfortable. A person pressing deliberately, watching the page respond,
   * takes the better part of a second between presses, and the whole run should
   * be allowed to be slow. This states that as a floor so the value cannot be
   * tightened back towards a reflex test without a test going red.
   */
  it('leaves enough room for an unhurried hand', () => {
    expect(WINDOW).toBeGreaterThanOrEqual(1000)
    expect(NEEDED * WINDOW).toBeGreaterThanOrEqual(5000)
  })

  it('starts a fresh run after one completes, rather than firing on every press after the fifth', () => {
    let streak = NO_STREAK
    let at = 10_000
    const fires: number[] = []
    // Twelve presses at a steady, comfortable pace: two complete runs, and
    // nothing in between.
    for (let i = 0; i < 12; i++) {
      const step = press(streak, at)
      streak = step.next
      if (step.fired) fires.push(i)
      at += 400
    }
    expect(fires).toEqual([4, 9])
  })

  it('does not accumulate across an afternoon of ordinary clicks', () => {
    // The reason the window is measured from the PREVIOUS press rather than the
    // first: this button navigates, so it gets pressed for its own sake.
    expect(run(20, 30_000)).toBe(false)
  })
})
