// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { inDesktopWindow, onUpdateReady, watchDesktop } from './desk'

type Host = {
  _wails?: {
    dispatchWailsEvent?: (ev: { name: string; data: unknown }) => void
    invoke?: (message: string) => void
  }
}

function send(name: string, data: unknown) {
  ;(window as unknown as Host)._wails?.dispatchWailsEvent?.({ name, data })
}

describe('run events in the desktop window', () => {
  const stops: (() => void)[] = []
  afterEach(() => stops.splice(0).forEach((stop) => stop()))

  // Wails runs no script in the window until it hears this, and puts invoke
  // on the page only after the page has started watching. First, because the
  // page says it once.
  it('tell Wails the page is ready once Wails can be told', () => {
    const said: string[] = []
    stops.push(watchDesktop(() => {}))
    const host = window as unknown as Host
    host._wails = { ...host._wails, invoke: (m) => said.push(m) }
    window.dispatchEvent(new Event('wails:runtime-config-ready'))
    stops.push(watchDesktop(() => {}))
    expect(said).toEqual(['wails:runtime:ready'])
  })

  it('reach every watcher with the same payload the stream carries', () => {
    const a: unknown[] = []
    const b: unknown[] = []
    stops.push(watchDesktop((d) => a.push(d)), watchDesktop((d) => b.push(d)))
    send('arrowloop:run', { job: 'photos', phase: 'progress', stage: 'list', done: 3 })
    expect(a).toEqual([{ job: 'photos', phase: 'progress', stage: 'list', done: 3 }])
    expect(b).toEqual(a)
  })

  it('leave out every other Wails event', () => {
    const got: unknown[] = []
    stops.push(watchDesktop((d) => got.push(d)))
    send('common:WindowShow', null)
    expect(got).toEqual([])
  })

  it('stop at the watcher that was closed', () => {
    const kept: unknown[] = []
    const closed: unknown[] = []
    stops.push(watchDesktop((d) => kept.push(d)))
    watchDesktop((d) => closed.push(d))()
    send('arrowloop:run', { job: 'photos', phase: 'finished' })
    expect(kept).toHaveLength(1)
    expect(closed).toEqual([])
  })

  it('are not expected in a browser, which keeps the stream', () => {
    expect(inDesktopWindow()).toBe(false)
  })

  it('leave out the news of a downloaded update', () => {
    const got: unknown[] = []
    stops.push(watchDesktop((d) => got.push(d)))
    send('arrowloop:update-ready', '1.2.0')
    expect(got).toEqual([])
  })
})

describe('a downloaded update', () => {
  // A container or a phone has no app that could replace itself.
  it('is not listened for outside the desktop window', () => {
    const got: string[] = []
    const stop = onUpdateReady((v) => got.push(v))
    send('arrowloop:update-ready', '1.2.0')
    stop()
    expect(got).toEqual([])
  })
})
