// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setSystemAccent, systemAccent } from './appearance'
import { browserAccent } from './browserAccent'
import { accentFrom, watchSystemAccent } from './systemAccent'

const answer = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.unstubAllGlobals()
  setSystemAccent(undefined)
  localStorage.clear()
})

describe('the desktop as a source', () => {
  it('asks the shell for its accent and again when the window comes back', async () => {
    const fetch = vi.fn(() => answer({ accent: '#0078D7' }))
    vi.stubGlobal('fetch', fetch)
    const stop = watchSystemAccent(true)
    await settle()
    expect(fetch).toHaveBeenCalledWith('/api/window/accent')
    expect(systemAccent()).toBe('#0078D7')

    fetch.mockImplementation(() => answer({ accent: '#E0383E' }))
    window.dispatchEvent(new Event('focus'))
    await settle()
    expect(systemAccent()).toBe('#E0383E')

    fetch.mockImplementation(() => answer({ accent: '' }))
    window.dispatchEvent(new Event('focus'))
    await settle()
    expect(systemAccent()).toBeUndefined()
    stop()
  })

  it('keeps the last colour when the shell cannot be asked', async () => {
    const fetch = vi.fn(() => answer({ accent: '#0078D7' }))
    vi.stubGlobal('fetch', fetch)
    const stop = watchSystemAccent(true)
    await settle()

    fetch.mockImplementation(() => Promise.resolve(new Response('', { status: 500 })))
    window.dispatchEvent(new Event('focus'))
    await settle()
    expect(systemAccent()).toBe('#0078D7')
    stop()
  })

  it('stops asking once it is stopped', async () => {
    const fetch = vi.fn(() => answer({ accent: '#0078D7' }))
    vi.stubGlobal('fetch', fetch)
    watchSystemAccent(true)()
    window.dispatchEvent(new Event('focus'))
    await settle()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('a browser as a source', () => {
  it('reads AccentColor and never asks a shell that is not there', async () => {
    const fetch = vi.fn(() => answer({ accent: '#0078D7' }))
    vi.stubGlobal('fetch', fetch)
    const stop = watchSystemAccent(false)
    await settle()
    expect(fetch).not.toHaveBeenCalled()
    expect(systemAccent()).toBe(browserAccent())
    stop()
  })
})

describe('the shell answer', () => {
  it('takes a colour and nothing else', () => {
    expect(accentFrom({ accent: '#0078d7' })).toBe('#0078d7')
    expect(accentFrom({ accent: '' })).toBeUndefined()
    expect(accentFrom({ accent: 'blue' })).toBeUndefined()
    expect(accentFrom({ accent: 12 })).toBeUndefined()
    expect(accentFrom(null)).toBeUndefined()
  })
})
