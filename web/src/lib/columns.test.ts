import { describe, expect, it } from 'vitest'

import { gridTemplate, mergeOrder, moveColumn, stepColumn, type ColumnDef } from './columns'

const defs: ColumnDef[] = [{ id: 'what', width: 200 }, { id: 'when', width: 160 }, { id: 'side', width: 24, fixed: true }, { id: 'path' }]

describe('a list column layout', () => {
  it('moves a column before or after another', () => {
    expect(moveColumn(['a', 'b', 'c'], 'c', 'a', false)).toEqual(['c', 'a', 'b'])
    expect(moveColumn(['a', 'b', 'c'], 'a', 'b', true)).toEqual(['b', 'a', 'c'])
  })

  it('steps a column one place and stops at either end', () => {
    expect(stepColumn(['a', 'b', 'c'], 'a', true)).toEqual(['b', 'a', 'c'])
    expect(stepColumn(['a', 'b', 'c'], 'a', false)).toEqual(['a', 'b', 'c'])
  })

  it('keeps a stored order across a build that adds and drops columns', () => {
    expect(mergeOrder(defs, ['path', 'gone', 'what'])).toEqual(['path', 'what', 'when', 'side'])
  })

  it('draws stored widths, the flexible column taking the rest', () => {
    expect(gridTemplate(defs, { order: [], widths: { when: 220 } })).toBe('200px 220px 24px minmax(120px, 1fr)')
  })

  it('never draws a column narrower than its floor', () => {
    expect(gridTemplate(defs, { order: [], widths: { what: 10 } }).split(' ')[0]).toBe('48px')
  })
})
