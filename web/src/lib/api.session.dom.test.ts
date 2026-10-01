// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, whenSignedOut } from './api'

function answer(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

afterEach(() => vi.unstubAllGlobals())

describe('an ended session', () => {
  it('is reported when any call is refused for want of one', async () => {
    vi.stubGlobal('fetch', () => answer(401, { error: 'this interface is password protected, log in first' }))
    const out = vi.fn()
    const stop = whenSignedOut(out)
    await expect(api.jobs()).rejects.toThrow('log in first')
    stop()
    expect(out).toHaveBeenCalledTimes(1)
  })

  it('is not reported for a wrong password at the login itself', async () => {
    vi.stubGlobal('fetch', () => answer(401, { error: 'wrong password' }))
    const out = vi.fn()
    const stop = whenSignedOut(out)
    await expect(api.login('nope')).rejects.toThrow('wrong password')
    await expect(api.loginWithPasskey()).rejects.toThrow()
    stop()
    expect(out).not.toHaveBeenCalled()
  })

  it('is reported when the event stream is shut out', async () => {
    let source: { readyState: number; onerror: (() => void) | null } | null = null
    vi.stubGlobal(
      'EventSource',
      Object.assign(
        class {
          readyState = 0
          onerror: (() => void) | null = null
          onmessage: unknown = null
          constructor() {
            source = this
          }
          close() {}
        },
        { CONNECTING: 0, OPEN: 1, CLOSED: 2 },
      ),
    )
    vi.stubGlobal('fetch', () => answer(200, { required: true, authenticated: false }))
    const out = vi.fn()
    const stop = whenSignedOut(out)
    const close = api.watch(() => undefined)

    source!.readyState = 2
    source!.onerror?.()
    await vi.waitFor(() => expect(out).toHaveBeenCalledTimes(1))
    close()
    stop()
  })
})
