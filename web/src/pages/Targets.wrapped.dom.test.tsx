// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Backend, Provider, Remote } from '../lib/api'
import { ToastProvider } from '../lib/toast'

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

type Option = Backend['options'][number]
const option = (name: string, extra: Partial<Option> = {}): Option => ({
  name,
  help: '',
  required: true,
  essential: true,
  secret: false,
  advanced: false,
  type: 'string',
  default: '',
  ...extra,
})

const backends: Backend[] = [
  { name: 'crypt', description: '', options: [option('remote'), option('password', { secret: true })] },
  { name: 'union', description: '', options: [option('upstreams')] },
  { name: 'combine', description: '', options: [option('upstreams')] },
  { name: 'sftp', description: '', options: [option('host')] },
]

const providers: Provider[] = [
  { id: 'crypt', name: 'Encrypted', backend: 'crypt', group: 'layered', mark: 'IconLock' },
  { id: 'union', name: 'Merged targets', backend: 'union', group: 'layered', mark: 'IconLink' },
  { id: 'combine', name: 'Combined targets', backend: 'combine', group: 'layered', mark: 'IconLink' },
]

const cern: Remote = {
  name: '3f9a1c02b7de',
  label: 'CERN Particle Accelerator',
  type: 'sftp',
  settings: [{ key: 'host', value: 'cern.example', secret: false }],
}
const nas: Remote = { name: 'nas', label: 'nas', type: 'sftp', settings: [{ key: 'host', value: 'nas', secret: false }] }

let savedTargets: Remote[] = []

const saveRemote = vi.fn((name: string, _type: string, _settings: Record<string, string>): Promise<unknown> =>
  Promise.resolve({ saved: name }),
)

vi.mock('../lib/api', () => ({
  api: {
    remotes: () => Promise.resolve({ remotes: savedTargets, backends, providers, unlisted: [] }),
    tryRemote: () => Promise.resolve({ ok: true }),
    volumes: () => Promise.resolve({ volumes: [] }),
    checkRemote: () => Promise.resolve({ ok: true }),
    aboutRemote: () => Promise.resolve({ supported: false }),
    saveRemote: (name: string, type: string, settings: Record<string, string>) => saveRemote(name, type, settings),
    addRemote: (label: string, type: string, settings: Record<string, string>) => saveRemote(label, type, settings),
  },
}))

const { Targets } = await import('./Targets')

afterEach(() => {
  cleanup()
  savedTargets = []
  saveRemote.mockClear()
})

function page() {
  render(
    <ToastProvider>
      <Targets />
    </ToastProvider>,
  )
}

async function add(name: string) {
  page()
  fireEvent.click(await screen.findByRole('button', { name: 'Connect storage and clouds' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name }))
  return screen.findByRole('dialog')
}

async function edit(label: string) {
  page()
  const row = (await screen.findByText(label)).closest('.glim-connection') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
  return screen.findByRole('dialog')
}

function pick(dialog: HTMLElement, control: string | RegExp, choice: string | RegExp, at = 0) {
  fireEvent.click(within(dialog).getAllByRole('button', { name: control })[at]!)
  fireEvent.click(screen.getByRole('option', { name: choice }))
}

async function saved(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(saveRemote).toHaveBeenCalled())
  return saveRemote.mock.calls[0]![2]
}

describe('the target a wrapper is built on', () => {
  it('offers the saved targets by name and id and saves the id', async () => {
    savedTargets = [cern, nas]
    const dialog = await add('Encrypted')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Target to wrap' }))
    expect(screen.getByRole('option', { name: 'CERN Particle Accelerator (3f9a1c02b7de)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'nas' })).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: 'CERN Particle Accelerator (3f9a1c02b7de)' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Folder in it' }), { target: { value: 'secret' } })
    expect((await saved(dialog)).remote).toBe('3f9a1c02b7de:secret')
  })

  it('takes a whole path for a folder on this machine', async () => {
    savedTargets = [nas]
    const dialog = await add('Encrypted')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Folder in it' }), { target: { value: '/mnt/backup' } })
    expect((await saved(dialog)).remote).toBe('/mnt/backup')
  })

  it('repairs a target that was typed by its name', async () => {
    savedTargets = [
      cern,
      {
        name: 'vault',
        label: 'Vault',
        type: 'crypt',
        settings: [
          { key: 'remote', value: 'CERN Particle Accelerator:enc', secret: false },
          { key: 'password', value: '********', secret: true },
        ],
      },
    ]
    const dialog = await edit('Vault')
    expect(within(dialog).getByRole('button', { name: 'Target to wrap' }).textContent).toContain(
      'CERN Particle Accelerator (3f9a1c02b7de)',
    )
    expect((await saved(dialog)).remote).toBe('3f9a1c02b7de:enc')
  })

  it('does not offer a target to wrap itself', async () => {
    savedTargets = [nas, { name: 'vault', label: 'Vault', type: 'crypt', settings: [{ key: 'remote', value: 'nas:', secret: false }] }]
    const dialog = await edit('Vault')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Target to wrap' }))
    expect(screen.queryByRole('option', { name: /Vault/ })).toBeNull()
  })
})

describe('the targets a union or combine joins', () => {
  it('saves every target added, each with its folder', async () => {
    savedTargets = [cern, nas]
    const dialog = await add('Merged targets')
    pick(dialog, 'Target to join', 'nas')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Folder in it' }), { target: { value: 'photos' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add a target' }))
    pick(dialog, 'Target to join', /CERN/, 1)
    expect((await saved(dialog)).upstreams).toBe('nas:photos 3f9a1c02b7de:')
  })

  it('drops a target that was taken out again', async () => {
    savedTargets = [
      cern,
      nas,
      { name: 'both', label: 'Both', type: 'union', settings: [{ key: 'upstreams', value: 'nas:a 3f9a1c02b7de:b:ro', secret: false }] },
    ]
    const dialog = await edit('Both')
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Remove this target' })[0]!)
    expect((await saved(dialog)).upstreams).toBe('3f9a1c02b7de:b:ro')
  })

  it('names the folder each combined target appears under', async () => {
    savedTargets = [nas]
    const dialog = await add('Combined targets')
    pick(dialog, 'Target to join', 'nas')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Shown as' }), { target: { value: 'My Photos' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Folder in it' }), { target: { value: 'photos' } })
    expect((await saved(dialog)).upstreams).toBe('"My Photos=nas:photos"')
  })
})

describe("a saved target's rclone id", () => {
  it('shows on its form with a button that copies it', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    savedTargets = [cern]
    const dialog = await edit('CERN Particle Accelerator')
    expect(within(dialog).getByText('3f9a1c02b7de')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy the ID' }))
    expect(writeText).toHaveBeenCalledWith('3f9a1c02b7de')
  })

  it('copies on a page opened over plain http, where the browser has no clipboard api', async () => {
    let copied = ''
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    document.execCommand = vi.fn(() => {
      copied = document.body.querySelector<HTMLTextAreaElement>(':scope > textarea')?.value ?? ''
      return true
    })
    savedTargets = [cern]
    const dialog = await edit('CERN Particle Accelerator')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy the ID' }))
    expect(await within(dialog).findByRole('button', { name: 'Copied' })).toBeTruthy()
    expect(copied).toBe('3f9a1c02b7de')
  })

  it('is not shown for a target that is not saved yet', async () => {
    const dialog = await add('Encrypted')
    expect(within(dialog).queryByRole('button', { name: 'Copy the ID' })).toBeNull()
  })
})
