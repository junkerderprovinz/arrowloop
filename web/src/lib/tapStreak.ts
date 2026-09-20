/**
 * Counting a run of deliberate presses on one control. The caller passes the
 * times in, so the window can be tested at human intervals without a clock.
 */

/**
 * How long a press stays part of the same run, measured from the previous
 * press so ordinary clicks cannot add up over an afternoon. Generous enough for
 * somebody watching the page change between presses.
 */
export const WINDOW = 1200

/** How many presses in a row the run needs. */
export const NEEDED = 5

/**
 * How long a single press has to be held to count on its own, since pressing
 * and holding is what people try first. The button still acts on release.
 */
export const HOLD = 600

export interface Streak {
  count: number
  /** When the last press landed, on the same clock the caller reads. */
  at: number
}

export const NO_STREAK: Streak = { count: 0, at: 0 }

/**
 * The streak after one more press at `now`, and whether that press completed a
 * run. A completed run starts over at zero, so later presses do not each fire.
 */
export function press(streak: Streak, now: number): { next: Streak; fired: boolean } {
  const within = now - streak.at < WINDOW
  const count = within ? streak.count + 1 : 1
  if (count >= NEEDED) return { next: { count: 0, at: now }, fired: true }
  return { next: { count, at: now }, fired: false }
}
