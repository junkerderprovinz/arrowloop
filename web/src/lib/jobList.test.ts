import { describe, expect, it } from 'vitest'

import { STRIP_LENGTH, jobStatus, runStrip } from './jobList'

const ok = { Err: '', Conflicts: 0, Skipped: 0, Started: '2027-03-01T10:00:00Z' }
const failed = { ...ok, Err: 'boom' }
const leftSomething = { ...ok, Conflicts: 2 }

function job(name: string, over: Partial<Parameters<typeof jobStatus>[0]> = {}) {
  return { name, left: `/data/${name}`, right: `remote:${name}`, running: false, disabled: false, recent: [ok], ...over }
}

describe('runStrip', () => {
  it('pads a young job at the old end and puts the newest run last', () => {
    const strip = runStrip([failed, ok])
    expect(strip).toHaveLength(STRIP_LENGTH)
    expect(strip.slice(0, STRIP_LENGTH - 2).every((t) => t === 'none')).toBe(true)
    expect(strip.slice(-2)).toEqual(['ok', 'fail'])
  })

  it('marks a run that set a conflict aside as one to look at', () => {
    expect(runStrip([leftSomething]).at(-1)).toBe('warn')
  })

  it('keeps only the newest fourteen', () => {
    const many = [failed, ...Array(20).fill(ok)]
    const strip = runStrip(many)
    expect(strip).toHaveLength(STRIP_LENGTH)
    expect(strip.at(-1)).toBe('fail')
  })
})

const quiet = { held: false, conflict: false, notes: false }
const held = { ...quiet, held: true }
const conflict = { ...quiet, conflict: true }
const noted = { ...quiet, notes: true }

describe('jobStatus', () => {
  it('says the loudest thing that applies', () => {
    expect(jobStatus(job('a', { running: true, recent: [failed] }), held)).toBe('running')
    expect(jobStatus(job('a', { recent: [failed] }), held)).toBe('held')
    expect(jobStatus(job('a', { recent: [failed], disabled: true }), conflict)).toBe('failed')
    expect(jobStatus(job('a', { disabled: true }), quiet)).toBe('paused')
    expect(jobStatus(job('a', { recent: [] }), quiet)).toBe('never')
    expect(jobStatus(job('a'), quiet)).toBe('last')
  })

  it('never rounds a held run or a waiting conflict up to the last good run', () => {
    expect(jobStatus(job('a'), held)).toBe('held')
    expect(jobStatus(job('a'), conflict)).toBe('conflict')
    expect(jobStatus(job('a'), { held: true, conflict: true, notes: false })).toBe('held')
  })

  it('never rounds a run that skipped files or a note up to the last good run', () => {
    expect(jobStatus(job('a', { recent: [{ ...ok, Skipped: 3 }] }), quiet)).toBe('warned')
    expect(jobStatus(job('a'), noted)).toBe('warned')
    expect(jobStatus(job('a', { recent: [ok, { ...ok, Skipped: 3 }] }), quiet)).toBe('last')
  })

  it('ranks a warning between a waiting conflict and a running job', () => {
    expect(jobStatus(job('a'), { ...noted, conflict: true })).toBe('conflict')
    expect(jobStatus(job('a', { running: true }), noted)).toBe('running')
  })

  it('names a waiting conflict on a paused job', () => {
    expect(jobStatus(job('a', { disabled: true }), conflict)).toBe('conflict')
  })

  it('forgets a failure once a later run worked', () => {
    expect(jobStatus(job('a', { recent: [ok, failed] }), quiet)).toBe('last')
  })
})
