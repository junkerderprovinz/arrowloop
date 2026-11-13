import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('a refusal', () => {
  it('keeps its code when the engine leaves the words to the page', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('{"ok":false,"code":"closedUntilNewPhrase"}', { status: 409, statusText: 'Conflict' })),
    )
    const refused = await api.joinFortress('twelve words').catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(ApiError)
    expect((refused as ApiError).code).toBe('closedUntilNewPhrase')
    expect((refused as ApiError).status).toBe(409)
  })
})
