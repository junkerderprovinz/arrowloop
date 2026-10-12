import { describe, expect, it } from 'vitest'

import { DEFAULT_VIEW, STRIP_LENGTH, jobStatus, jobsInView, runStrip } from './jobList'

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
    const view = { ...DEFAULT_VIEW, sort: { field: 'status' as const, reversed: false } }
    const jobs = [job('busy', { running: true }), job('warned'), job('waiting')]
    const waits = (n: string) => ({ ...quiet, notes: n === 'warned', conflict: n === 'waiting' })
    expect(jobsInView(jobs, view, '', waits).map((j) => j.name)).toEqual(['waiting', 'warned', 'busy'])
  })

  it('names a waiting conflict on a paused job', () => {
    expect(jobStatus(job('a', { disabled: true }), conflict)).toBe('conflict')
  })

  it('forgets a failure once a later run worked', () => {
    expect(jobStatus(job('a', { recent: [ok, failed] }), quiet)).toBe('last')
  })
})

describe('jobsInView', () => {
  const jobs = [job('photos'), job('music', { recent: [failed] }), job('notes', { disabled: true })]
  const none = () => quiet

  it('sorts by name both ways', () => {
    expect(jobsInView(jobs, DEFAULT_VIEW, '', none).map((j) => j.name)).toEqual(['music', 'notes', 'photos'])
    const back = { ...DEFAULT_VIEW, sort: { field: 'name' as const, reversed: true } }
    expect(jobsInView(jobs, back, '', none).map((j) => j.name)).toEqual(['photos', 'notes', 'music'])
  })

  it('puts problems first when sorted by status', () => {
    const view = { ...DEFAULT_VIEW, sort: { field: 'status' as const, reversed: false } }
    expect(jobsInView(jobs, view, '', none)[0].name).toBe('music')
  })

  it('keeps only what needs a look under trouble', () => {
    const view = { ...DEFAULT_VIEW, filter: 'trouble' as const }
    expect(jobsInView(jobs, view, '', (n) => ({ ...quiet, held: n === 'photos' })).map((j) => j.name)).toEqual(['music', 'photos'])
  })

  it('counts a waiting conflict as something to look at', () => {
    const view = { ...DEFAULT_VIEW, filter: 'trouble' as const }
    expect(jobsInView(jobs, view, '', (n) => ({ ...quiet, conflict: n === 'notes' })).map((j) => j.name)).toEqual(['music', 'notes'])
  })

  it('finds a job by the folder it syncs', () => {
    expect(jobsInView(jobs, DEFAULT_VIEW, 'REMOTE:NOTES', none).map((j) => j.name)).toEqual(['notes'])
  })
})
