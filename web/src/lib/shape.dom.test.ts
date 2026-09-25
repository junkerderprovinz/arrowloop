// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { applyShape, DEFAULT_SHAPE, LEAF_TAPS, leafTap, SHAPES } from './appearance'

/** Taps `tapped` n times while `current` is chosen, returning what the last tap revealed. */
function tap(n: number, tapped: string, current: string, state = { taps: 0 }) {
  let found: string | undefined
  for (let i = 0; i < n; i++) found = leafTap(state, tapped, current)
  return found
}

describe('the leaf behind square', () => {
  it('shows after five more taps on a chosen square', () => {
    expect(tap(LEAF_TAPS - 1, 'square', 'square')).toBeUndefined()
    expect(tap(LEAF_TAPS, 'square', 'square')).toBe('leaf')
  })

  it('counts nothing while square is not yet chosen', () => {
    expect(tap(LEAF_TAPS, 'square', 'soft')).toBeUndefined()
  })

  it('starts over when another shape is tapped', () => {
    const state = { taps: 0 }
    tap(LEAF_TAPS - 1, 'square', 'square', state)
    leafTap(state, 'round', 'square')
    expect(tap(LEAF_TAPS - 1, 'square', 'square', state)).toBeUndefined()
  })

  it('is not in the picker', () => {
    expect(SHAPES).not.toContain('leaf')
  })

  it('survives being applied from storage', () => {
    applyShape('leaf')
    expect(document.documentElement.getAttribute('data-shape')).toBe('leaf')
  })
})

describe('the default shape', () => {
  it('is soft', () => {
    expect(DEFAULT_SHAPE).toBe('soft')
  })

  it('replaces a value nobody could have chosen', () => {
    applyShape('blob')
    expect(document.documentElement.getAttribute('data-shape')).toBe('soft')
  })
})
