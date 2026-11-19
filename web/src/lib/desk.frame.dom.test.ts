// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://wails.localhost/" }
import { afterEach, describe, expect, it } from 'vitest'

import { drawsOwnFrame } from './desk'

function open(address: string) {
  window.history.replaceState(null, '', address)
}

afterEach(() => {
  sessionStorage.clear()
  open('/')
})

describe('the title bar in the desktop window', () => {
  it("is the page's own where the shell says nothing", () => {
    open('/?lang=de')
    expect(drawsOwnFrame()).toBe(true)
  })

  it('is left to the window manager where the shell says it draws one', () => {
    open('/?frame=system&lang=de')
    expect(drawsOwnFrame()).toBe(false)
  })

  it('stays with the window manager on a page whose address has lost the word', () => {
    open('/?frame=system')
    drawsOwnFrame()
    open('/settings')
    expect(drawsOwnFrame()).toBe(false)
  })

  it('is never drawn in the small window at the tray icon', () => {
    open('/?view=activity')
    expect(drawsOwnFrame()).toBe(false)
  })
})
