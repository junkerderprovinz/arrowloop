// The motion engine: how much movement the interface makes.
//
// Three states on the document root, exactly as the shape engine does radius:
// `off` · `subtle` · `full`, with the SAME keyframes at every intensity and
// only the numbers changing. "Subtle" and "off" are smaller durations and
// distances, never forked animations.
//
// Default is full. This axis is polish somebody dials DOWN, not a fallback
// somebody has to opt into, which is the opposite of the theme axis and for the
// opposite reason.
//
// It composes with the operating system's own reduced-motion signal and never
// overrides it: the tokens below only ever resolve inside the
// `prefers-reduced-motion: no-preference` block, so a machine reporting reduced
// motion never evaluates them at all. Picking "off" by hand gives the same
// numbers that block already uses, rather than a second recipe tuned
// separately.

export type MotionIntensity = 'off' | 'subtle' | 'full'

export const MOTION_INTENSITIES: MotionIntensity[] = ['off', 'subtle', 'full']

export const DEFAULT_MOTION: MotionIntensity = 'full'

const STORAGE_KEY = 'arrowloop.motion'
const ATTRIBUTE = 'data-motion'

function isIntensity(value: unknown): value is MotionIntensity {
  return typeof value === 'string' && (MOTION_INTENSITIES as string[]).includes(value)
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
