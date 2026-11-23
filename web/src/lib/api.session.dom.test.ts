// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, whenSignedOut } from './api'

function answer(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

afterEach(() => vi.unstubAllGlobals())

describe('an ended session', () => {
  it('is reported when any call is refused for want of one', async () => {
    vi.stubGlobal('fetch', () => answer(401, { code: 'signInFirst', error: 'this interface is password protected, sign in first' }))
    const out = vi.fn()
    const stop = whenSignedOut(out)
    await expect(api.jobs()).rejects.toThrow('sign in first')
    stop()
    expect(out).toHaveBeenCalledWith('ended')
  })

  it('is not reported for a refusal that carries a code of its own', async () => {
    vi.stubGlobal('fetch', () => answer(401, { error: 'wrongPassword' }))
    const out = vi.fn()
    const stop = whenSignedOut(out)
    await expect(api.jobs()).rejects.toThrow('wrongPassword')
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
    vi.stubGlobal('fetch', () => answer(401, { code: 'signInFirst', error: 'sign in first' }))
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

describe('a change that wants a fresh sign-in', () => {
  it('says so, and whether the password may stand in for it', async () => {
    vi.stubGlobal('fetch', () => answer(403, { error: 'signInAgain', askPassword: true }))
    const e = await api.revealPhrase().catch((err: unknown) => err)
    expect(e).toBeInstanceOf(ApiError)
    expect((e as ApiError).code).toBe('signInAgain')
    expect((e as ApiError).askPassword).toBe(true)
  })

  it('sends no password along any more', async () => {
    const sent: (string | undefined)[] = []
    vi.stubGlobal('fetch', (_: string, init?: RequestInit) => {
      sent.push(init?.body as string | undefined)
      return answer(200, { phrase: 'a b', code: 'a b' })
    })
    await api.showFortressPhrase()
    expect(sent).toEqual(['{}'])
  })
})
