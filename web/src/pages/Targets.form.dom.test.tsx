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

const onedrive: Backend = { name: 'onedrive', description: '', options: [option('token', { secret: true })] }

const kdrive: Backend = {
  name: 'kdrive',
  description: '',
  options: [option('token', { secret: true }), option('drive_id'), option('root_folder_id')],
}

const providers: Provider[] = [
  { id: 'ftp', name: 'FTP', backend: 'ftp', group: 'protocol', mark: 'IconTransfer' },
  { id: 'onedrive', name: 'OneDrive', backend: 'onedrive', group: 'cloud', mark: 'IconOnedrive' },
  { id: 'kdrive', name: 'Infomaniak kDrive', backend: 'kdrive', group: 'cloud', mark: 'IconTabStorage' },
]

let savedTargets: Remote[] = []

const saveRemote = vi.fn((name: string, _type: string, _settings: Record<string, string>): Promise<unknown> =>
  Promise.resolve({ saved: name }),
)
const drives = { name: 'config_driveid', choices: [{ value: 'me', help: 'OneDrive (personal)' }, { value: 'team', help: 'Team files' }] }
const tryRemote = vi.fn((_type: string, settings: Record<string, string>) =>
  Promise.resolve(settings.config_driveid ? { ok: true } : { ok: false, reason: 'choose', question: drives }),
)

vi.mock('../lib/api', () => ({
  api: {
    remotes: () => Promise.resolve({ remotes: savedTargets, backends: [ftp, onedrive, kdrive], providers, unlisted: [] }),
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
  savedTargets = []
  saveRemote.mockReset()
  saveRemote.mockImplementation((name: string) => Promise.resolve({ saved: name }))
  tryRemote.mockClear()
})

async function add(name: string) {
  render(
    <ToastProvider>
      <Targets />
    </ToastProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Connect storage and clouds' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name }))
  return screen.findByRole('dialog')
}

const addFtp = () => add('FTP')

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

describe('a sign-in that opens more than one drive', () => {
  it('asks which drive at the test and sends the one picked', async () => {
    const dialog = await add('OneDrive')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Test connection' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Drive' }))
    fireEvent.click(screen.getByRole('option', { name: 'Team files' }))
    fireEvent.click(within(dialog).getByRole('button', { name: /Test connection|Not connected/ }))
    await waitFor(() => expect(tryRemote).toHaveBeenCalledTimes(2))
    expect(tryRemote.mock.calls[1][1]).toMatchObject({ config_driveid: 'team' })
  })

  it('turns a save that waits for the choice into the test that asks it', async () => {
    saveRemote.mockImplementation(() => Promise.reject(Object.assign(new Error('choose'), { code: 'setup-question' })))
    const dialog = await add('OneDrive')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('button', { name: 'Drive' })).toBeTruthy()
  })
})

describe('the kDrive root folder', () => {
  const pick = (dialog: HTMLElement, name: string) => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Root folder' }))
    fireEvent.click(screen.getByRole('option', { name }))
  }

  it("leaves rclone's default, the private folder, when nothing is picked", async () => {
    const dialog = await add('Infomaniak kDrive')
    expect(within(dialog).getByRole('button', { name: 'Root folder' }).textContent).toBe('Private folder')
    expect((await saved(dialog)).root_folder_id).toBeUndefined()
  })

  it('saves the shared folder as common', async () => {
    const dialog = await add('Infomaniak kDrive')
    pick(dialog, 'Shared folder')
    expect((await saved(dialog)).root_folder_id).toBe('common')
  })

  it('clears a saved shortcut when the folder ID is left empty', async () => {
    savedTargets = [
      {
        name: 'kd',
        type: 'kdrive',
        settings: [
          { key: 'drive_id', value: '123456', secret: false },
          { key: 'root_folder_id', value: 'common', secret: false },
        ],
      },
    ]
    render(
      <ToastProvider>
        <Targets />
      </ToastProvider>,
    )
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Root folder' }).textContent).toBe('Shared folder')
    pick(dialog, 'Another folder, by ID')
    expect((await saved(dialog)).root_folder_id).toBe('')
  })

  it('takes any other folder by the ID typed in', async () => {
    const dialog = await add('Infomaniak kDrive')
    expect(within(dialog).queryByRole('textbox', { name: 'Folder ID' })).toBeNull()
    pick(dialog, 'Another folder, by ID')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Folder ID' }), { target: { value: '98765' } })
    expect((await saved(dialog)).root_folder_id).toBe('98765')
  })
})
