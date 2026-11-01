import { describe, expect, it } from 'vitest'

import { placeMenu, placeUnderHead } from './menuPlace'

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

describe('a list head filter', () => {
  const area = { left: 260, right: 1000, top: 0, bottom: 800 }
  const panel = { width: 340, height: 180 }

  it('opens under its head with the leading edges in line', () => {
    const at = placeUnderHead({ left: 300, right: 380, top: 100, bottom: 120 }, { left: 360, right: 380, top: 100, bottom: 120 }, panel, area)
    expect(at).toEqual({ left: 300, top: 124, maxHeight: 800 - 8 - 124 })
  })

  it('moves back from the end of the column rather than out of it', () => {
    const at = placeUnderHead({ left: 900, right: 980, top: 100, bottom: 120 }, { left: 960, right: 980, top: 100, bottom: 120 }, panel, area)
    expect(at.left).toBe(1000 - 8 - panel.width)
  })

  it('never covers the sidebar beside the column', () => {
    const wide = { width: 900, height: 180 }
    const at = placeUnderHead({ left: 270, right: 300, top: 100, bottom: 120 }, { left: 290, right: 300, top: 100, bottom: 120 }, wide, area)
    expect(at.left).toBe(268)
  })

  it('stays inside the page and scrolls a long list of choices', () => {
    const tall = { width: 340, height: 1341 }
    const at = placeUnderHead({ left: 300, right: 380, top: 240, bottom: 264 }, { left: 360, right: 380, top: 240, bottom: 264 }, tall, { ...area, bottom: 1000 })
    expect(at.top).toBe(268)
    expect(at.top + at.maxHeight).toBe(1000 - 8)
  })

  it('opens above a head near the bottom of the page', () => {
    const at = placeUnderHead({ left: 300, right: 380, top: 700, bottom: 720 }, { left: 360, right: 380, top: 700, bottom: 720 }, panel, area)
    expect(at.top).toBe(700 - 4 - panel.height)
  })
})
