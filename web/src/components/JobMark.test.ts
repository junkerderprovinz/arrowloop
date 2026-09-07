import { describe, expect, it } from 'vitest'

import { statusOf } from './JobMark'
import type { Job } from '../lib/api'

/**
 * Which of four things a job's mark says, when more than one could be true.
 *
 * This is the whole of the component worth testing, and it is not obvious: a
 * job can be running AND have failed last time, or be switched off AND have
 * failed last time, and the mark has one colour to spend. Getting the order
 * wrong shows an alarm on a job that is currently working fine, which is the
 * fastest way to teach somebody to ignore the mark.
 */

const job = (over: Partial<Job> = {}): Job =>
  ({ name: 'photos', running: false, disabled: false, ...over }) as Job

describe('what the mark says', () => {
  it('says running even when the last run failed', () => {
    // A job that is working right now is not currently broken, whatever
    // happened last time. The fail colour would be describing the past while
    // the arrows are turning about the present.
    expect(statusOf(job({ running: true }), true)).toBe('running')
  })

  it('says running even when the job is switched off', () => {
    // Held on its schedule and started by hand is a normal thing to do, and it
    // is exactly the state the pause button exists to allow. Showing "paused"
    // while it works would call the button a liar.
    expect(statusOf(job({ running: true, disabled: true }), false)).toBe('running')
  })

  it('says paused rather than failed when it is switched off', () => {
    // A switched-off job is not going to fix its own last run, so the fact
    // worth showing is the one somebody can act on.
    expect(statusOf(job({ disabled: true }), true)).toBe('paused')
  })

  it('says failed when nothing else is going on', () => {
    expect(statusOf(job(), true)).toBe('failed')
  })

  it('says ready otherwise', () => {
    expect(statusOf(job(), false)).toBe('ok')
  })
})
