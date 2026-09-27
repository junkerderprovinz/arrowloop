import { describe, expect, it } from 'vitest'

import { placeMenu } from './menuPlace'

const viewport = { width: 1000, height: 800 }
const menu = { width: 200, height: 180 }

describe('a menu', () => {
  it('opens under its button with the trailing edges in line', () => {
    const at = placeMenu({ left: 700, right: 740, top: 100, bottom: 132 }, menu, viewport)
    expect(at).toEqual({ left: 540, top: 136 })
  })

  it('lines up the leading edges in a right-to-left page', () => {
    const at = placeMenu({ left: 300, right: 340, top: 100, bottom: 132 }, menu, viewport, true)
    expect(at.left).toBe(300)
  })

  it('stays inside a narrow window', () => {
    const narrow = { width: 360, height: 800 }
    const nearStart = placeMenu({ left: 16, right: 56, top: 100, bottom: 132 }, menu, narrow)
    expect(nearStart.left).toBe(8)
    const nearEnd = placeMenu({ left: 330, right: 370, top: 100, bottom: 132 }, menu, narrow, true)
    expect(nearEnd.left + menu.width).toBeLessThanOrEqual(narrow.width - 8)
  })

  it('opens above a button near the bottom of the window', () => {
    const at = placeMenu({ left: 700, right: 740, top: 700, bottom: 732 }, menu, viewport)
    expect(at.top).toBe(700 - 4 - menu.height)
  })

  it('keeps opening downwards when there is no more room above', () => {
    const short = { width: 1000, height: 250 }
    const at = placeMenu({ left: 700, right: 740, top: 60, bottom: 92 }, menu, short)
    expect(at.top).toBe(96)
  })
})
