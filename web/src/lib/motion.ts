// How much movement the interface makes, as `data-motion` on the document
// root. Every level runs the same keyframes with different numbers.
//
// The values are matched by the stylesheet and stored, so they are a format
// rather than wording. The tokens only resolve inside the
// `prefers-reduced-motion: no-preference` block, so the system setting always
// wins.

export type MotionIntensity = 'off' | 'subtle' | 'wild' | 'storm'

/** What the picker offers, in order. `storm` is revealed by a gesture in App.tsx. */
export const MOTION_INTENSITIES: MotionIntensity[] = ['off', 'subtle', 'wild']

/** Every value a stored preference may hold, so a stored `storm` survives a reload. */
export const MOTION_VALUES: MotionIntensity[] = ['off', 'subtle', 'wild', 'storm']

export const DEFAULT_MOTION: MotionIntensity = 'wild'

const STORAGE_KEY = 'arrowloop.motion'
const ATTRIBUTE = 'data-motion'

function isIntensity(value: unknown): value is MotionIntensity {
  return typeof value === 'string' && (MOTION_VALUES as string[]).includes(value)
}

/** The stored preference, defaulting when unset or corrupt. */
export function getMotion(): MotionIntensity {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    // A private window can throw on access.
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
    // Unremembered, but still applied for this session.
  }
  applyMotion(value)
}

/** Called before the first render, so the page does not animate at the wrong level once. */
export function applyStoredMotion(): void {
  applyMotion(getMotion())
}
