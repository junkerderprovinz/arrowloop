import { describe, expect, it } from 'vitest'

import { oneRowFit } from './segmentLayout'

describe('a selector that keeps to one row', () => {
  const labels = [110, 100, 150, 90]
  const glyphs = [44, 44, 44, 44]

  it('makes every segment as wide as the widest while that fits', () => {
    expect(oneRowFit(4 * 150 + 3 * 4, 4, labels, glyphs, 2)).toBe('even')
  })

  it('sizes the segments by their labels once even shares run short', () => {
    expect(oneRowFit(470, 4, labels, glyphs, 2)).toBe('content')
  })

  it('keeps the label of the chosen segment and shows the others as glyphs after that', () => {
    expect(oneRowFit(300, 4, labels, glyphs, 2)).toBe('chosen')
  })

  it('shows every segment as a glyph where not even the chosen label fits', () => {
    expect(oneRowFit(200, 4, labels, glyphs, 2)).toBe('glyphs')
    expect(oneRowFit(300, 4, labels, glyphs, -1)).toBe('glyphs')
  })
})
