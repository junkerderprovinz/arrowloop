import { describe, expect, it } from 'vitest'

import { statusOf } from './JobMark'
import type { Job } from '../lib/api'

// A job can be running or switched off and have failed last time, and the mark
// has one colour to spend.

const job = (over: Partial<Job> = {}): Job =>
  ({ name: 'photos', running: false, disabled: false, ...over }) as Job

describe('what the mark says', () => {
  it('says running even when the last run failed', () => {
    expect(statusOf(job({ running: true }), true)).toBe('running')
  })

  it('says running even when the job is switched off', () => {
    // A paused job can still be started by hand.
    expect(statusOf(job({ running: true, disabled: true }), false)).toBe('running')
  })

  it('says paused rather than failed when it is switched off', () => {
    expect(statusOf(job({ disabled: true }), true)).toBe('paused')
  })

  it('says failed when nothing else is going on', () => {
    expect(statusOf(job(), true)).toBe('failed')
  })

  it('says ready otherwise', () => {
    expect(statusOf(job(), false)).toBe('ok')
  })
})
