// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Backend, Provider, Remote } from '../lib/api'
import { ToastProvider } from '../lib/toast'

// jsdom has no ResizeObserver, which the README buttons use to fit their names.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

const providers: Provider[] = [
  { id: 'gdrive', name: 'Google Drive', backend: 'drive', group: 'cloud', mark: 'IconGoogleDrive' },
  { id: 'ulozto', name: 'Ulož.to', backend: 'ulozto', group: 'cloud', mark: 'IconUlozto' },
  { id: 's3', name: 'S3 compatible', backend: 's3', group: 'storage', mark: 'IconBuckets' },
  { id: 'webdav', name: 'WebDAV', backend: 'webdav', group: 'protocol', mark: 'IconServer' },
]

const option = (name: string, secret = false) => ({
  name,
  help: '',
  required: true,
  secret,
  advanced: false,
  default: '',
})
const webdav: Backend = { name: 'webdav', description: '', options: [option('url'), option('user'), option('pass', true)] }

const stored: Remote = {
  name: 'nas',
  type: 'webdav',
  settings: [
    { key: 'pass', value: '********', secret: true },
    { key: 'url', value: 'https://nas.example/dav', secret: false },
    { key: 'user', value: 'reeve', secret: false },
  ],
}

const saveRemote = vi.fn((name: string, type: string, settings: Record<string, string>) =>
  Promise.resolve({ saved: name, type, settings }),
)

vi.mock('../lib/api', () => ({
  api: {
    remotes: () => Promise.resolve({ remotes: [stored], backends: [webdav], providers, unlisted: [] }),
    volumes: () => Promise.resolve({ volumes: [] }),
    checkRemote: () => Promise.resolve({ ok: true }),
    aboutRemote: () => Promise.resolve({ supported: false }),
    saveRemote: (name: string, type: string, settings: Record<string, string>) => saveRemote(name, type, settings),
  },
}))

const { Targets } = await import('./Targets')

afterEach(() => {
  cleanup()
  saveRemote.mockClear()
})

async function openPicker() {
  render(
    <ToastProvider>
      <Targets />
    </ToastProvider>,
  )
  await screen.findByText('nas:')
  fireEvent.click(screen.getByRole('button', { name: 'Connect storage and clouds' }))
  const dialog = await screen.findByRole('dialog')
  return { dialog, search: within(dialog).getByRole('searchbox', { name: 'Search storage and clouds' }) }
}

const tiles = (dialog: HTMLElement) =>
  Array.from(dialog.querySelectorAll('.glim-provider-pick button')).map((b) => b.getAttribute('aria-label'))

describe('the storage picker', () => {
  it('opens with its search already in place and every group shown', async () => {
    const { dialog } = await openPicker()
    expect(tiles(dialog)).toEqual(['Google Drive', 'Ulož.to', 'S3 compatible', 'WebDAV'])
  })

  it('narrows every group at once, ignoring accents', async () => {
    const { dialog, search } = await openPicker()
    fireEvent.change(search, { target: { value: 'uloz' } })
    expect(tiles(dialog)).toEqual(['Ulož.to'])
    expect(within(dialog).queryByText('Object storage')).toBeNull()
  })

  it('finds a service by its rclone name', async () => {
    const { dialog, search } = await openPicker()
    fireEvent.change(search, { target: { value: 'drive' } })
    expect(tiles(dialog)).toEqual(['Google Drive'])
  })

  it('says so when nothing matches and names the tiles that take most others', async () => {
    const { dialog, search } = await openPicker()
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(tiles(dialog)).toEqual([])
    expect(within(dialog).getByText('Nothing matches "zzz". Most other services work with S3 compatible or WebDAV.')).toBeTruthy()
  })

  it('empties the search on Escape before the window closes', async () => {
    const { search } = await openPicker()
    fireEvent.change(search, { target: { value: 'uloz' } })
    fireEvent.keyDown(search, { key: 'Escape' })
    expect((search as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.keyDown(search, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('a stored secret in the target form', () => {
  async function edit() {
    render(
      <ToastProvider>
        <Targets />
      </ToastProvider>,
    )
    await screen.findByText('nas:')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    return screen.findByRole('dialog')
  }

  it('shows as Saved with Change instead of a field', async () => {
    const dialog = await edit()
    expect(within(dialog).getByText('Saved')).toBeTruthy()
    expect(dialog.querySelector('input[type="password"]')).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Change' }))
    expect(dialog.querySelector('input[type="password"]')).not.toBeNull()
  })

  it('goes back untouched when somebody saves without changing it', async () => {
    const dialog = await edit()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saveRemote).toHaveBeenCalled())
    expect(saveRemote.mock.calls[0][2]).toMatchObject({ pass: '********', url: 'https://nas.example/dav' })
  })

  it('goes back to the stored one when a change is abandoned', async () => {
    const dialog = await edit()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change' }))
    fireEvent.change(dialog.querySelector('input[type="password"]')!, { target: { value: 'half typed' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep the saved one' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saveRemote).toHaveBeenCalled())
    expect(saveRemote.mock.calls[0][2]).toMatchObject({ pass: '********' })
  })
})
