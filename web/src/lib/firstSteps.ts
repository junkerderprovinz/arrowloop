// The way from a new install to its first sync: three steps, what the machine
// already holds, and where the person stands.

import type { Translate } from './i18n.data'

export const FIRST_STEPS = ['target', 'job', 'preview'] as const

export type FirstStep = (typeof FIRST_STEPS)[number]

export type StepState = 'done' | 'next' | 'open'

/**
 * Marks the first step still to do as next and every later one as open. Two
 * folders on one machine need no target, so the first step is done by a
 * target as well as by a job; the welcome page goes once there is a job, so
 * the two later steps are never done here.
 */
export function stepStates(hasTarget: boolean): Record<FirstStep, StepState> {
  return hasTarget ? { target: 'done', job: 'next', preview: 'open' } : { target: 'next', job: 'open', preview: 'open' }
}

export interface Found {
  /** Targets rclone already knows, from a configuration that was there before. */
  targets: number
  /** Drives the machine reports that a job could sync to. */
  drives: number
}

/** What was found, or null where the machine holds nothing to name. */
export function foundLine(found: Found, t: Translate): string | null {
  const parts = [
    found.targets > 0 && t('welcome.foundTargets', { count: found.targets }),
    found.drives > 0 && t('welcome.foundDrives', { count: found.drives }),
  ].filter((part) => part !== false)
  return parts.length > 0 ? parts.join(' · ') : null
}
