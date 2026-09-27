// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Remote } from '../lib/api'

const target = (name: string): Remote => ({
  name,
  type: 'webdav',
  settings: [{ key: 'url', value: `https://${name}.example/`, secret: false }],
})

const checked = vi.fn((name: string) => Promise.resolve(name === 'home' ? { ok: true } : { ok: false, reason: '404' }))

vi.mock('../lib/api', () => ({
  api: {
    remotes: () =>
      Promise.resolve({
        remotes: [
          target('home'),
          target('away'),
          { name: 'here', type: 'alias', settings: [{ key: 'remote', value: 'D:/Backups', secret: false }] },
        ],
        backends: [],
        providers: [],
        unlisted: [],
      }),
    volumes: () => Promise.resolve({ volumes: [] }),
    checkRemote: (name: string) => checked(name),
    aboutRemote: () => Promise.resolve({ supported: false }),
  },
}))

const { Targets } = await import('./Targets')

afterEach(cleanup)

describe('Targets', () => {
  it('says whether each target is connected without being asked', async () => {
    render(<Targets />)

    expect(await screen.findByText('Connected')).toBeTruthy()
    expect(await screen.findByText('Not connected')).toBeTruthy()
    expect(checked).toHaveBeenCalledWith('home')
    expect(checked).toHaveBeenCalledWith('away')
  })

  it('leaves a folder on this device without a connection to report', async () => {
    render(<Targets />)

    await screen.findByText('here:')
    await screen.findByText('Not connected')
    expect(checked).not.toHaveBeenCalledWith('here')
    expect(screen.getAllByText(/^(Connected|Not connected)$/)).toHaveLength(2)
  })
})
