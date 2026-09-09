/**
 * Counting a run of deliberate presses on one control.
 *
 * A function rather than three lines inside the component, and the reason is
 * the bug that put it here. The easter egg it counts for was verified by
 * clicking the logo five times from a script, which happens in the same
 * millisecond, and the window was set to 600ms between presses on that
 * evidence. A person pressing five times deliberately takes closer to half a
 * second per press and often longer, because each press visibly changes the
 * page - so the streak reset under a real hand, every time, and the feature
 * simply did not exist for anybody but the test. jdp: "das easter egg geht
 * nicht."
 *
 * Pulled out here so the window can be checked at HUMAN intervals without a
 * browser, a clock or a click: the test passes the times in.
 */

/**
 * WINDOW is how long a press stays "part of the same run", measured from the
 * PREVIOUS press rather than from the first.
 *
 * From the previous one, so an ordinary click on the way to another tab cannot
 * accumulate towards the streak over an afternoon. 1.2 seconds, because that is
 * unhurried for somebody pressing on purpose and still nothing like the pace of
 * somebody using the button for what it says it does. Five presses may take up
 * to 4.8 seconds in total, and that is meant to be generous: this is a joke
 * somebody has to find, not a reflex test.
 */
export const WINDOW = 1200

/** How many presses in a row the run needs. */
export const NEEDED = 5

export interface Streak {
  /** How many presses the current run holds. */
  count: number
  /** When the last one landed, on the same clock the caller reads. */
  at: number
}

export const NO_STREAK: Streak = { count: 0, at: 0 }

/**
 * The streak after one more press at `now`, and whether that press completed a
 * run.
 *
 * A completed run resets the count to zero rather than leaving it at five, so
 * the next five presses are a fresh run instead of every single press past the
 * fifth firing again.
 */
export function press(streak: Streak, now: number): { next: Streak; fired: boolean } {
  const within = now - streak.at < WINDOW
  const count = within ? streak.count + 1 : 1
  if (count >= NEEDED) return { next: { count: 0, at: now }, fired: true }
  return { next: { count, at: now }, fired: false }
}
