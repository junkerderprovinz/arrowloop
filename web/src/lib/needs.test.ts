import { describe, expect, it } from 'vitest'
import type { Finding } from './anomalies'
import { needs, type JobState } from './needs'

function finding(id: string, held: boolean, job = 'photos'): Finding {
  return { id, job, kind: held ? 'delete' : 'overdue', severity: held ? 'critical' : 'warning', held, since: '', seen: '', open: true }
}

function job(name: string, over: Partial<JobState> = {}): JobState {
  return { name, disabled: false, ran: true, failed: false, ...over }
}

describe('needs', () => {
  it('is in sync when nothing waits', () => {
    expect(needs(0, [], [job('photos')])).toEqual({ head: 'inSync', items: [] })
  })

  it('never rounds a note up to in sync', () => {
    expect(needs(0, [finding('a', false)], []).head).toBe('withNotes')
  })

  it('needs the person for an open conflict', () => {
    expect(needs(2, [], []).head).toBe('needsYou')
  })

  it('needs the person for a held run and names it', () => {
    const got = needs(0, [finding('a', true), finding('b', false)], [])
    expect(got.head).toBe('needsYou')
    expect(got.items).toEqual([
      { kind: 'held', job: 'photos', finding: 'a' },
      { kind: 'notes', count: 1 },
    ])
  })

  it('is not in sync while an enabled job has never run', () => {
    const got = needs(0, [], [job('photos', { ran: false })])
    expect(got.head).toBe('withNotes')
    expect(got.items).toEqual([{ kind: 'neverRan', job: 'photos' }])
  })

  it('names a job whose last run failed as a note', () => {
    const got = needs(0, [], [job('photos', { failed: true })])
    expect(got).toEqual({ head: 'withNotes', items: [{ kind: 'failed', job: 'photos' }] })
  })

  it('leaves a paused job out', () => {
    expect(needs(0, [], [job('photos', { disabled: true, ran: false })]).head).toBe('inSync')
  })

  it('keeps an urgent head when a job also has not run', () => {
    expect(needs(1, [], [job('photos', { ran: false })]).head).toBe('needsYou')
  })

  it('gives a job its finding already speaks for no second line', () => {
    const got = needs(0, [finding('a', false, 'photos')], [job('photos', { failed: true })])
    expect(got.items).toEqual([{ kind: 'notes', count: 1 }])
  })
})
