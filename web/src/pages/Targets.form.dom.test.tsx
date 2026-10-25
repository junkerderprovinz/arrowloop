// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Backend, Provider } from '../lib/api'
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
  required: false,
  essential: true,
  secret: false,
  advanced: false,
  type: 'string',
  default: '',
  ...extra,
})

const ftp: Backend = {
  name: 'ftp',
  description: '',
  options: [
    option('host'),
    option('port', { default: '21', type: 'int' }),
    option('tls', { type: 'bool', default: 'false' }),
    option('explicit_tls', { type: 'bool', default: 'false' }),
    option('disable_epsv', { type: 'bool', default: 'false', essential: false }),
  ],
}

const providers: Provider[] = [{ id: 'ftp', name: 'FTP', backend: 'ftp', group: 'protocol', mark: 'IconTransfer' }]

const saveRemote = vi.fn((name: string, _type: string, _settings: Record<string, string>) => Promise.resolve({ saved: name }))

vi.mock('../lib/api', () => ({
  api: {
    remotes: () => Promise.resolve({ remotes: [], backends: [ftp], providers, unlisted: [] }),
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

async function addFtp() {
  render(
    <ToastProvider>
      <Targets />
    </ToastProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Connect storage and clouds' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'FTP' }))
  return screen.findByRole('dialog')
}

async function saved(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(saveRemote).toHaveBeenCalled())
  return saveRemote.mock.calls[0][2]
}

describe('the target form', () => {
  it('draws a yes-or-no setting as a switch', async () => {
    const dialog = await addFtp()
    const epsv = within(dialog).getByRole('switch', { name: 'disable_epsv' })
    expect(epsv.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(epsv)
    expect((await saved(dialog)).disable_epsv).toBe('true')
  })

  it('asks for FTP encryption once and never sets both kinds of TLS', async () => {
    const dialog = await addFtp()
    expect(within(dialog).queryByRole('switch', { name: 'tls' })).toBeNull()
    expect(within(dialog).queryByRole('switch', { name: 'explicit_tls' })).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Encryption' }))
    fireEvent.click(screen.getByRole('option', { name: 'Implicit TLS on port 990' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Encryption' }))
    fireEvent.click(screen.getByRole('option', { name: 'Explicit TLS' }))

    const settings = await saved(dialog)
    expect(settings.explicit_tls).toBe('true')
    expect(settings.tls).toBeUndefined()
  })
})
