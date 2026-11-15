// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Backend, CheckAnswer, Provider, Remote } from '../lib/api'
import type { RefusedCertificate } from '../lib/certificate'
import { ToastProvider } from '../lib/toast'

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

const option = (name: string): Backend['options'][number] => ({
  name,
  help: '',
  required: false,
  essential: true,
  secret: name === 'pass',
  advanced: false,
  type: 'string',
  default: '',
})

const webdav: Backend = {
  name: 'webdav',
  description: '',
  trustsCertificate: true,
  options: [option('url'), option('user'), option('pass')],
}

const providers: Provider[] = [{ id: 'nextcloud', name: 'Nextcloud', backend: 'webdav', group: 'cloud', preset: { vendor: 'nextcloud' } }]

const own: RefusedCertificate = {
  fingerprint: 'AB:CD:EF',
  subject: 'nextcloud.lan',
  issuer: 'nextcloud.lan',
  notAfter: '2030-06-01T00:00:00Z',
  changed: false,
}

const refused = (certificate: RefusedCertificate): CheckAnswer => ({
  ok: false,
  reason: 'tls: failed to verify certificate: x509: certificate signed by unknown authority',
  failure: { code: 'certificateUntrusted' },
  certificate,
})

const remotes: Remote[] = []
const tryRemote = vi.fn(
  (_type: string, settings: Record<string, string>): Promise<CheckAnswer> =>
    Promise.resolve(settings.trusted_certificate === own.fingerprint ? { ok: true } : refused(own)),
)
const saveRemote = vi.fn((name: string, _type: string, _settings: Record<string, string>) => Promise.resolve({ saved: name }))

vi.mock('../lib/api', () => ({
  api: {
    remotes: () => Promise.resolve({ remotes, backends: [webdav], providers, unlisted: [] }),
    tryRemote: (type: string, settings: Record<string, string>) => tryRemote(type, settings),
    volumes: () => Promise.resolve({ volumes: [] }),
    checkRemote: () => Promise.resolve({ ok: true }),
    aboutRemote: () => Promise.resolve({ supported: false }),
    saveRemote: (name: string, type: string, settings: Record<string, string>) => saveRemote(name, type, settings),
  },
}))

const { Targets } = await import('./Targets')

afterEach(() => {
  cleanup()
  remotes.length = 0
  tryRemote.mockClear()
  saveRemote.mockClear()
})

function show() {
  render(
    <ToastProvider>
      <Targets />
    </ToastProvider>,
  )
}

async function addNextcloud() {
  show()
  fireEvent.click(await screen.findByRole('button', { name: 'Connect storage and clouds' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Nextcloud' }))
  return screen.findByRole('dialog')
}

async function saved(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(saveRemote).toHaveBeenCalled())
  return saveRemote.mock.calls[0][2]
}

describe('a server certificate no authority vouches for', () => {
  it('is shown with its fingerprint after a test, and trusting it tests again and saves it', async () => {
    const dialog = await addNextcloud()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Test connection' }))

    const offer = (await within(dialog).findByText('Certificate not trusted')).closest('section') as HTMLElement
    expect(within(offer).getByText('AB:CD:EF')).toBeTruthy()
    expect(within(offer).getAllByText('nextcloud.lan')).toHaveLength(2)

    fireEvent.click(within(offer).getByRole('button', { name: 'Trust this certificate' }))
    await waitFor(() => expect(tryRemote).toHaveBeenCalledTimes(2))
    expect(tryRemote.mock.calls[1][1]).toMatchObject({ trusted_certificate: 'AB:CD:EF' })
    expect(await within(dialog).findByText('Trusted certificate')).toBeTruthy()

    expect((await saved(dialog)).trusted_certificate).toBe('AB:CD:EF')
  })

  it('says when it is not the one the target trusts', async () => {
    tryRemote.mockImplementationOnce(() => Promise.resolve(refused({ ...own, fingerprint: '12:34:56', changed: true })))
    const dialog = await addNextcloud()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Test connection' }))

    const offer = (await within(dialog).findByText('The certificate has changed')).closest('section') as HTMLElement
    expect(within(offer).getByText('12:34:56')).toBeTruthy()
    expect(within(dialog).queryByText('Certificate not trusted')).toBeNull()
  })

  it('stays trusted in the editor until it is removed, and removing it clears the setting', async () => {
    remotes.push({
      name: 'cloud',
      type: 'webdav',
      settings: [
        { key: 'url', value: 'https://nextcloud.lan/remote.php/webdav', secret: false },
        { key: 'trusted_certificate', value: 'AB:CD:EF', secret: false },
      ],
    })
    show()
    await screen.findByText('cloud:')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')

    const card = within(dialog).getByText('Trusted certificate').closest('section') as HTMLElement
    expect(within(card).getByText('AB:CD:EF')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Stop trusting' }))
    expect(within(dialog).queryByText('Trusted certificate')).toBeNull()

    expect((await saved(dialog)).trusted_certificate).toBe('')
  })
})
