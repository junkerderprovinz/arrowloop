import { describe, expect, it } from 'vitest'
import type { Finding } from './anomalies'
import { needs } from './needs'

function finding(id: string, held: boolean): Finding {
  return { id, job: 'photos', kind: held ? 'delete' : 'overdue', severity: held ? 'critical' : 'warning', held, since: '', seen: '', open: true }
}

describe('needs', () => {
  it('is in sync when nothing waits', () => {
    expect(needs(0, [])).toEqual({ head: 'inSync', items: [] })
  })

  it('never rounds a note up to in sync', () => {
    expect(needs(0, [finding('a', false)]).head).toBe('withNotes')
  })

  it('needs the person for an open conflict', () => {
    expect(needs(2, []).head).toBe('needsYou')
  })

  it('needs the person for a held run and names it', () => {
    const got = needs(0, [finding('a', true), finding('b', false)])
    expect(got.head).toBe('needsYou')
    expect(got.items).toEqual([
      { kind: 'held', job: 'photos', finding: 'a' },
      { kind: 'notes', count: 1 },
    ])
  })
})
