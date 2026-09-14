// The motion engine: how much movement the interface makes.
//
// Four states on the document root, exactly as the shape engine does radius:
// `off` · `subtle` · `wild` · `storm`, with the SAME keyframes at every
// intensity and only the numbers changing. "Subtle" and "off" are smaller
// durations and distances, never forked animations; "storm" is a bigger number
// again through the same keyframes.
//
// THE VALUES ARE A WIRE FORMAT, not wording. They go into `data-motion` on
// <html>, the stylesheet's own selectors match on them and localStorage holds
// them, so renaming one is renaming an interface rather than a label.
//
// THREE OF THE FOUR ARE IN THE PICKER, which is why there are two lists below.
// `storm` is the hidden fourth (the gesture that reveals it lives in App.tsx)
// and it is a real level rather than a joke, so a stored `storm` has to come
// back after a reload. What may be CHOSEN and what may legally be STORED are
// different questions, and one list cannot answer both.
//
// Default is wild. This axis is polish somebody dials DOWN, not a fallback
// somebody has to opt into, which is the opposite of the theme axis and for the
// opposite reason.
//
// It composes with the operating system's own reduced-motion signal and never
// overrides it: the tokens below only ever resolve inside the
// `prefers-reduced-motion: no-preference` block, so a machine reporting reduced
// motion never evaluates them at all. Picking "off" by hand gives the same
// numbers that block already uses, rather than a second recipe tuned
// separately.

export type MotionIntensity = 'off' | 'subtle' | 'wild' | 'storm'

/** What the picker offers, in order. `storm` is deliberately not in it. */
export const MOTION_INTENSITIES: MotionIntensity[] = ['off', 'subtle', 'wild']

/**
 * Every value a stored preference may legally hold, picker or not.
 *
 * Validating a stored value against MOTION_INTENSITIES would read a found
 * `storm` as corrupt and quietly put the person back on wild at the next
 * reload - an easter egg that changes a setting has to be a setting, and a
 * setting that forgets itself is a bug wearing a joke's clothes.
 */
export const MOTION_VALUES: MotionIntensity[] = ['off', 'subtle', 'wild', 'storm']

export const DEFAULT_MOTION: MotionIntensity = 'wild'

const STORAGE_KEY = 'arrowloop.motion'
const ATTRIBUTE = 'data-motion'

/** Against the STORED list, never the picker's: see MOTION_VALUES. */
function isIntensity(value: unknown): value is MotionIntensity {
  return typeof value === 'string' && (MOTION_VALUES as string[]).includes(value)
}

/** The stored preference, defaulting when unset or corrupt. */
export function getMotion(): MotionIntensity {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    // A private window throws on access rather than answering null, and the
    // default is a perfectly good answer there.
  }
  return isIntensity(stored) ? stored : DEFAULT_MOTION
}

/** Sets the attribute the stylesheet keys off, validating first. */
export function applyMotion(value: MotionIntensity | string | undefined): void {
  document.documentElement.setAttribute(ATTRIBUTE, isIntensity(value) ? value : DEFAULT_MOTION)
}

/** Persists the choice and applies it at once, with no separate save step. */
export function setMotion(value: MotionIntensity): void {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Not being able to remember a choice is no reason to refuse it for this
    // session.
  }
  applyMotion(value)
}

/**
 * Called at boot, before the first render, so the page never animates once at
 * one intensity and settles into another.
 */
export function applyStoredMotion(): void {
  applyMotion(getMotion())
}
