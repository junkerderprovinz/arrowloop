// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Backend, CheckAnswer, Provider, Remote } from '../lib/api'
import { en } from '../lib/i18n.data'
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
  options: [
    option('token', { secret: true }),
    option('drive_id'),
    option('root_folder_id', { essential: false, advanced: true }),
  ],
}

const internxt: Backend = {
  name: 'internxt',
  description: '',
  options: [option('email', { required: true }), option('pass', { required: true, secret: true })],
}

const providers: Provider[] = [
  { id: 'ftp', name: 'FTP', backend: 'ftp', group: 'protocol', mark: 'IconTransfer' },
  { id: 'onedrive', name: 'OneDrive', backend: 'onedrive', group: 'cloud', mark: 'IconOnedrive' },
  { id: 'kdrive', name: 'Infomaniak kDrive', backend: 'kdrive', group: 'cloud', mark: 'IconTabStorage' },
  { id: 'internxt', name: 'Internxt', backend: 'internxt', group: 'cloud', mark: 'IconInternxt' },
]

let savedTargets: Remote[] = []

const saveRemote = vi.fn((name: string, _type: string, _settings: Record<string, string>): Promise<unknown> =>
  Promise.resolve({ saved: name }),
)
const drives = { name: 'config_driveid', choices: [{ value: 'me', help: 'OneDrive (personal)' }, { value: 'team', help: 'Team files' }] }
const drivesAnswer = (_type: string, settings: Record<string, string>): Promise<CheckAnswer> =>
  Promise.resolve(settings.config_driveid ? { ok: true } : { ok: false, reason: 'choose', question: drives })
const tryRemote = vi.fn(drivesAnswer)

vi.mock('../lib/api', () => ({
  api: {
    remotes: () => Promise.resolve({ remotes: savedTargets, backends: [ftp, onedrive, kdrive, internxt], providers, unlisted: [] }),
    tryRemote: (type: string, settings: Record<string, string>) => tryRemote(type, settings),
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
  saveRemote.mockReset()
  saveRemote.mockImplementation((name: string) => Promise.resolve({ saved: name }))
  tryRemote.mockReset()
  tryRemote.mockImplementation(drivesAnswer)
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
  it('keeps the other settings folded until they are opened', async () => {
    const dialog = await addFtp()
    expect(within(dialog).queryByRole('region', { name: 'Other settings' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Other settings' }))
    expect(within(dialog).getByRole('region', { name: 'Other settings' })).toBeTruthy()
  })

  it('draws a yes-or-no setting as a switch', async () => {
    const dialog = await addFtp()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Other settings' }))
    const epsv = within(dialog).getByRole('switch', { name: 'Turn off EPSV' })
    expect(epsv.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(epsv)
    expect((await saved(dialog)).disable_epsv).toBe('true')
  })

  it("shows rclone's name inside an empty field until the field gets focus", async () => {
    const dialog = await addFtp()
    const port = within(dialog).getByRole('textbox', { name: 'Port' })
    expect(port.getAttribute('placeholder')).toBe('port')
    fireEvent.focus(port)
    expect(port.getAttribute('placeholder')).toBeNull()
    fireEvent.blur(port)
    expect(port.getAttribute('placeholder')).toBe('port')
  })

  it("says rclone's default in the field's bubble rather than in the field", async () => {
    const dialog = await addFtp()
    expect(within(dialog).getByRole('img', { name: /Default: 21$/ })).toBeTruthy()
  })

  it('asks for FTP encryption once and never sets both kinds of TLS', async () => {
    const dialog = await addFtp()
    expect(within(dialog).queryByRole('switch', { name: 'Implicit TLS' })).toBeNull()
    expect(within(dialog).queryByRole('switch', { name: 'Explicit TLS' })).toBeNull()

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

describe('an account that signs in with a two-factor code', () => {
  const code = { name: 'config_2fa', choices: [] }

  it('asks for the code at the test and sends what was typed', async () => {
    tryRemote.mockImplementation((_type, settings) =>
      Promise.resolve(settings.config_2fa ? { ok: true } : { ok: false, reason: 'answer', question: code }),
    )
    const dialog = await add('Internxt')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Test connection' }))
    const field = await within(dialog).findByRole('textbox', { name: 'Two-factor code' })
    expect(field.getAttribute('inputmode')).toBe('numeric')
    fireEvent.change(field, { target: { value: '123456' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Test connection|Not connected/ }))
    await waitFor(() => expect(tryRemote).toHaveBeenCalledTimes(2))
    expect(tryRemote.mock.calls[1][1]).toMatchObject({ config_2fa: '123456' })
  })

  it('says a refused code in plain words', async () => {
    tryRemote.mockImplementation(() =>
      Promise.resolve({ ok: false, reason: 'Wrong 2-factor auth code (status 401)', failure: { code: 'twoFactorRefused' } }),
    )
    const dialog = await add('Internxt')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Test connection' }))
    const verdict = within(dialog).getByRole('button', { name: 'Test connection' })
    await waitFor(() => expect(verdict.className).toMatch(/glim-shake/))
    fireEvent.focus(verdict)
    expect(await screen.findByText(/two-factor code was not accepted/)).toBeTruthy()
  })
})

describe('a save whose sign-in is refused', () => {
  it("says so once in the reader's words instead of rclone's", async () => {
    const said = 'login failed: failed to access: access: Wrong login credentials (status 401)'
    saveRemote.mockImplementation(() => Promise.reject(Object.assign(new Error(said), { failure: { code: 'signInFailed' } })))
    const dialog = await add('Internxt')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findAllByText(en['failure.signInFailed'], { selector: '.glim-toast-message' })).toHaveLength(1)
    expect(screen.queryByText(said, { selector: '.glim-toast-message' })).toBeNull()
  })
})

describe('the kDrive root folder', () => {
  const others = (dialog: HTMLElement) => within(within(dialog).getByRole('region', { name: 'Other settings' }))
  const unfold = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Other settings' }))
  const pick = (dialog: HTMLElement, name: string) => {
    fireEvent.click(others(dialog).getByRole('button', { name: 'Root folder' }))
    fireEvent.click(screen.getByRole('option', { name }))
  }

  it("leaves rclone's default, the private folder, when nothing is picked", async () => {
    const dialog = await add('Infomaniak kDrive')
    unfold(dialog)
    expect(others(dialog).getByRole('button', { name: 'Root folder' }).textContent).toBe('Private folder')
    expect((await saved(dialog)).root_folder_id).toBeUndefined()
  })

  it('saves the shared folder as common', async () => {
    const dialog = await add('Infomaniak kDrive')
    unfold(dialog)
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
    expect(others(dialog).getByRole('button', { name: 'Root folder' }).textContent).toBe('Shared folder')
    pick(dialog, 'Another folder, by ID')
    expect((await saved(dialog)).root_folder_id).toBe('')
  })

  it('takes any other folder by the ID typed in', async () => {
    const dialog = await add('Infomaniak kDrive')
    unfold(dialog)
    expect(within(dialog).queryByRole('textbox', { name: 'Folder ID' })).toBeNull()
    pick(dialog, 'Another folder, by ID')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Folder ID' }), { target: { value: '98765' } })
    expect((await saved(dialog)).root_folder_id).toBe('98765')
  })
})
