// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Remote, Volume } from '../lib/api'
import { ToastProvider } from '../lib/toast'

const target = (name: string): Remote => ({
  name,
  type: 'webdav',
  settings: [{ key: 'url', value: `https://${name}.example/`, secret: false }],
})

const checked = vi.fn((name: string) => Promise.resolve(name === 'home' ? { ok: true } : { ok: false, reason: '404' }))
const volumes = vi.fn(() => Promise.resolve({ volumes: [] as Volume[] }))
const deleteRemote = vi.fn((name: string) => Promise.resolve({ deleted: name }))
const forgetVolume = vi.fn((id: string) => Promise.resolve({ forgotten: id }))

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
    forgetVolume: (id: string) => forgetVolume(id),
  },
}))

const { Targets } = await import('./Targets')

beforeEach(() => {
  volumes.mockReset()
  volumes.mockImplementation(() => Promise.resolve({ volumes: [] as Volume[] }))
  deleteRemote.mockReset()
  deleteRemote.mockImplementation((name: string) => Promise.resolve({ deleted: name }))
})
afterEach(cleanup)

function show() {
  render(
    <ToastProvider>
      <Targets />
    </ToastProvider>,
  )
}

async function deleteFirst() {
  await screen.findByText('home:')
  fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete it' }))
}

describe('Targets', () => {
  it('says whether each target is connected without being asked', async () => {
    show()

    expect(await screen.findByText('Connected')).toBeTruthy()
    expect(await screen.findByText('Not connected')).toBeTruthy()
    expect(checked).toHaveBeenCalledWith('home')
    expect(checked).toHaveBeenCalledWith('away')
  })

  it('leaves a folder on this device without a connection to report', async () => {
    show()

    await screen.findByText('here:')
    await screen.findByText('Not connected')
    expect(checked).not.toHaveBeenCalledWith('here')
    expect(screen.getAllByText(/^(Connected|Not connected)$/)).toHaveLength(2)
  })

  it('drops the unreachable banner once both lists load again', async () => {
    volumes.mockImplementationOnce(() => Promise.reject(new Error('Failed to fetch')))
    show()
    await screen.findByText('Cannot reach the engine')

    await deleteFirst()
    await waitFor(() => expect(screen.queryByText('Cannot reach the engine')).toBeNull())
  })

  it('says why a target could not be deleted', async () => {
    deleteRemote.mockImplementationOnce(() => Promise.reject(new Error('no remote called "home"')))
    show()
    await deleteFirst()
    expect(await screen.findByText('no remote called "home"')).toBeTruthy()
  })

  it('says why a drive could not be forgotten', async () => {
    const drive: Volume = { id: 'abc', label: 'Backup drive', mount: '/mnt/backup',attached: true, lastSeen: null, path: 'volume:abc' }
    volumes.mockImplementation(() => Promise.resolve({ volumes: [drive] }))
    forgetVolume.mockImplementationOnce(() => Promise.reject(new Error('Failed to fetch')))
    show()
    await screen.findByText('Backup drive')
    const row = screen.getByText('Backup drive').closest('li') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete it' }))
    expect(await screen.findByText('Failed to fetch')).toBeTruthy()
  })
})
