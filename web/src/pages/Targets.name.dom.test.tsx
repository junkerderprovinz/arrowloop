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

const sftp: Backend = {
  name: 'sftp',
  description: '',
  options: [
    {
      name: 'host',
      help: '',
      required: true,
      essential: true,
      secret: false,
      advanced: false,
      type: 'string',
      default: '',
    },
  ],
}
const providers: Provider[] = [{ id: 'sftp', name: 'SFTP', backend: 'sftp', group: 'protocol', mark: 'IconTransfer' }]

let savedTargets: Remote[] = []
const addRemote = vi.fn((_label: string, _type: string, _settings: Record<string, string>): Promise<unknown> =>
  Promise.resolve({ saved: 'SFTP-Home-Lab' }),
)
const saveRemote = vi.fn((name: string, _type: string, _settings: Record<string, string>, _label?: string): Promise<unknown> =>
  Promise.resolve({ saved: name }),
)

vi.mock('../lib/api', () => ({
  api: {
    remotes: () => Promise.resolve({ remotes: savedTargets, backends: [sftp], providers, unlisted: [] }),
    tryRemote: () => Promise.resolve({ ok: true }),
    volumes: () => Promise.resolve({ volumes: [] }),
    checkRemote: () => Promise.resolve({ ok: true }),
    aboutRemote: () => Promise.resolve({ supported: false }),
    addRemote: (label: string, type: string, settings: Record<string, string>) => addRemote(label, type, settings),
    saveRemote: (name: string, type: string, settings: Record<string, string>, label?: string) =>
      saveRemote(name, type, settings, label),
  },
}))

const { Targets } = await import('./Targets')

afterEach(() => {
  cleanup()
  savedTargets = []
  addRemote.mockClear()
  saveRemote.mockClear()
})

function page() {
  render(
    <ToastProvider>
      <Targets />
    </ToastProvider>,
  )
}

function name(dialog: HTMLElement, value: string) {
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value } })
}

describe('the name of a target', () => {
  it('is saved as typed, spaces and dashes included', async () => {
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect storage and clouds' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'SFTP' }))
    const dialog = await screen.findByRole('dialog')
    name(dialog, 'SFTP Home - Lab')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(addRemote).toHaveBeenCalled())
    expect(addRemote.mock.calls[0]![0]).toBe('SFTP Home - Lab')
    expect(saveRemote).not.toHaveBeenCalled()
  })

  it('renames the target it belongs to and adds none', async () => {
    savedTargets = [{ name: 'SFTP-1', type: 'sftp', settings: [{ key: 'host', value: 'lab.example', secret: false }] }]
    page()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!)
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('SFTP-1')
    name(dialog, 'OneDrive - Business')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saveRemote).toHaveBeenCalled())
    expect(saveRemote.mock.calls[0]![0]).toBe('SFTP-1')
    expect(saveRemote.mock.calls[0]![3]).toBe('OneDrive - Business')
    expect(addRemote).not.toHaveBeenCalled()
  })

  it('says under the field when another target has the name', async () => {
    savedTargets = [{ name: 'SFTP-1', type: 'sftp', settings: [] }]
    saveRemote.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('taken'), { code: 'target-name-taken', values: { name: 'Backup' } })),
    )
    page()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!)
    const dialog = await screen.findByRole('dialog')
    name(dialog, 'Backup')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Another target is already called Backup. Pick a different name so you can tell the two apart.',
    )
  })
})
