import { describe, expect, it } from 'vitest'

import { edgeAt } from './desk'

describe('the edge a press resizes from', () => {
  it.each([
    ['the middle', 180, 240, ''],
    ['the top', 180, 2, 'n'],
    ['the bottom', 180, 477, 's'],
    ['the left', 1, 240, 'w'],
    ['the right', 357, 240, 'e'],
    ['the top left corner', 2, 3, 'nw'],
    ['the bottom right corner', 358, 478, 'se'],
    ['just inside the border', 6, 6, ''],
  ])('%s', (_, x, y, want) => {
    expect(edgeAt(x, y, 360, 480)).toBe(want)
  })
})
