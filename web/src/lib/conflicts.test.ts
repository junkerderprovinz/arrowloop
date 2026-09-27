import { describe, expect, it } from 'vitest'

import type { OpenConflict } from './api'
import { conflictKey, decisionsByJob, mergeConflicts, newerSide, stillListed } from './conflicts'

function conflict(job: string, plain: string, at: string, leftMod: string, rightMod: string): OpenConflict {
  return {
    job,
    plain,
    copy: plain.replace('.txt', '.conflict-left-20260927-100000.txt'),
    side: 'left',
    at,
    left: { path: plain, size: 1, mod: leftMod },
    right: { path: plain, size: 2, mod: rightMod },
  }
}

const a = conflict('docs', 'a.txt', '2026-09-27T10:00:00Z', '2026-09-27T09:00:00Z', '2026-09-27T09:30:00Z')
const b = conflict('docs', 'b.txt', '2026-09-27T11:00:00Z', '2026-09-27T09:45:00Z', '2026-09-27T09:15:00Z')
const c = conflict('photos', 'a.txt', '2026-09-27T12:00:00Z', '2026-09-27T09:00:00Z', '2026-09-27T09:00:00Z')

describe('the conflicts tab', () => {
  it('names the side with the newer version, and neither when the times agree', () => {
    expect(newerSide(a)).toBe('right')
    expect(newerSide(b)).toBe('left')
    expect(newerSide(c)).toBeNull()
  })

  it('tells the same path apart in two jobs', () => {
    expect(conflictKey(a)).not.toBe(conflictKey(c))
  })

  it('sends one request per job for a choice made on many rows', () => {
    const grouped = decisionsByJob([a, c, b], 'right')
    expect([...grouped.keys()]).toEqual(['docs', 'photos'])
    expect(grouped.get('docs')).toEqual([
      { copy: a.copy, keep: 'right' },
      { copy: b.copy, keep: 'right' },
    ])
    expect(grouped.get('photos')).toEqual([{ copy: c.copy, keep: 'right' }])
  })

  it('replaces one job\'s rows and keeps the others in time order', () => {
    const listing = (conflicts: OpenConflict[], unread: { job: string; error: string }[] = []) => ({ conflicts, unread })
    expect(mergeConflicts(listing([a, b, c]), 'docs', listing([b])).conflicts).toEqual([b, c])
    expect(mergeConflicts(listing([c]), 'docs', listing([b, a])).conflicts).toEqual([a, b, c])
    expect(mergeConflicts(listing([a, b, c]), '', listing([c])).conflicts).toEqual([c])
    expect(mergeConflicts(null, 'docs', listing([a])).conflicts).toEqual([a])

    // A job that could be read again stops being reported, and another job's report stays.
    const held = listing([], [
      { job: 'docs', error: 'drive not attached' },
      { job: 'photos', error: 'drive not attached' },
    ])
    expect(mergeConflicts(held, 'docs', listing([a])).unread).toEqual([{ job: 'photos', error: 'drive not attached' }])
  })

  it('forgets a selection once its conflict has been decided', () => {
    const selected = new Set([conflictKey(a), conflictKey(b)])
    expect([...stillListed(selected, [b, c])]).toEqual([conflictKey(b)])
    // Unchanged selections come back as the same set, so state does not churn.
    expect(stillListed(selected, [a, b])).toBe(selected)
  })
})
