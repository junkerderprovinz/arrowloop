import { describe, expect, it } from 'vitest'

import type { TrashSide } from './api'
import { byJob, inJobOrder, mergeTrash, trashTotals } from './trashView'

function side(job: string, name: 'left' | 'right', total: number, bytes: number): TrashSide {
  return { job, side: name, store: 'trash', dir: '.arrowloop/trash', total, bytes, entries: [] }
}

describe('the trash tab', () => {
  it('adds up every side, counting entries beyond those listed', () => {
    expect(trashTotals([side('docs', 'left', 3, 300), side('docs', 'right', 1, 20)])).toEqual({ entries: 4, bytes: 320 })
    expect(trashTotals([])).toEqual({ entries: 0, bytes: 0 })
  })

  it('replaces only the job that was asked for again', () => {
    const held = [side('docs', 'left', 1, 1), side('photos', 'left', 5, 5)]
    const merged = mergeTrash(held, 'photos', [side('photos', 'left', 0, 0)])
    expect(merged.map((s) => `${s.job}/${s.total}`)).toEqual(['docs/1', 'photos/0'])
  })

  it('takes a full answer as it is when no job was named', () => {
    const fresh = [side('docs', 'left', 1, 1)]
    expect(mergeTrash([side('photos', 'left', 5, 5)], '', fresh)).toEqual(fresh)
    expect(mergeTrash(null, 'docs', fresh)).toEqual(fresh)
  })

  it('keeps the configuration order, left before right, and a job gone from it last', () => {
    const sides = [side('old', 'left', 1, 1), side('docs', 'right', 1, 1), side('photos', 'left', 1, 1), side('docs', 'left', 1, 1)]
    expect(inJobOrder(sides, ['photos', 'docs']).map((s) => `${s.job}/${s.side}`)).toEqual([
      'photos/left',
      'docs/left',
      'docs/right',
      'old/left',
    ])
  })

  it('groups the sides under their job', () => {
    const groups = byJob([side('docs', 'left', 1, 1), side('docs', 'right', 1, 1), side('photos', 'left', 1, 1)])
    expect(groups.map((g) => [g.job, g.sides.length])).toEqual([
      ['docs', 2],
      ['photos', 1],
    ])
  })
})
