import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('saving a target', () => {
  it('asks the engine to refuse a taken name only when adding', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', (path: string) => {
      asked.push(path)
      return Promise.resolve(new Response('{"saved":"nas"}', { status: 200 }))
    })
    await api.saveRemote('nas', 'sftp', {}, true)
    await api.saveRemote('nas', 'sftp', {})
    expect(asked).toEqual(['/api/remotes/nas?new=1', '/api/remotes/nas'])
  })
})
