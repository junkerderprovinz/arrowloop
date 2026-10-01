// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Remote } from '../lib/api'

const target = (name: string): Remote => ({
  name,
  type: 'webdav',
  settings: [{ key: 'url', value: `https://${name}.example/`, secret: false }],
})

const checked = vi.fn((name: string) => Promise.resolve(name === 'home' ? { ok: true } : { ok: false, reason: '404' }))
const volumes = vi.fn(() => Promise.resolve({ volumes: [] }))
const deleteRemote = vi.fn((name: string) => Promise.resolve({ deleted: name }))

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
    volumes: () => volumes(),
    checkRemote: (name: string) => checked(name),
    aboutRemote: () => Promise.resolve({ supported: false }),
    deleteRemote: (name: string) => deleteRemote(name),
  },
}))

const { Targets } = await import('./Targets')

beforeEach(() => {
  volumes.mockReset()
  volumes.mockImplementation(() => Promise.resolve({ volumes: [] }))
  deleteRemote.mockReset()
  deleteRemote.mockImplementation((name: string) => Promise.resolve({ deleted: name }))
})
afterEach(cleanup)

async function deleteFirst() {
  await screen.findByText('home:')
  fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete it' }))
}

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

  it('drops the unreachable banner once both lists load again', async () => {
    volumes.mockImplementationOnce(() => Promise.reject(new Error('Failed to fetch')))
    render(<Targets />)
    await screen.findByText('Cannot reach the engine')

    await deleteFirst()
    await waitFor(() => expect(screen.queryByText('Cannot reach the engine')).toBeNull())
  })
})
