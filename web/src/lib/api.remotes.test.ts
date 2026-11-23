import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from './api'
import { targetLabel } from './targetLabels'

afterEach(() => vi.unstubAllGlobals())

describe('saving a target', () => {
  it('adds under the typed name and edits under the id', async () => {
    const asked: { path: string; method?: string; body: unknown }[] = []
    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
      asked.push({ path, method: init?.method, body: JSON.parse(String(init?.body)) })
      return Promise.resolve(new Response('{"saved":"SFTP-Home-Lab"}', { status: 200 }))
    })
    const made = await api.addRemote('SFTP Home Lab', 'sftp', {})
    await api.saveRemote(made.saved, 'sftp', {}, 'Lab')
    expect(asked).toEqual([
      { path: '/api/remotes', method: 'POST', body: { label: 'SFTP Home Lab', type: 'sftp', settings: {} } },
      { path: '/api/remotes/SFTP-Home-Lab', method: 'PUT', body: { label: 'Lab', type: 'sftp', settings: {} } },
    ])
  })
})

describe('reading the targets', () => {
  it('teaches every side name the labels', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            remotes: [{ name: 'SFTP-1', label: 'SFTP Home Lab', type: 'sftp', settings: [] }],
            backends: [],
            providers: [],
            unlisted: null,
          }),
          { status: 200 },
        ),
      ),
    )
    await api.remotes()
    expect(targetLabel('SFTP-1')).toBe('SFTP Home Lab')
    expect(targetLabel('elsewhere')).toBe('elsewhere')
  })
})
