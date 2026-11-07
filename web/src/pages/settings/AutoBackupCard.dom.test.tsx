// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AutoBackups, Settings } from '../../lib/api'

const latest = { name: 'arrowloop-auto-20261107-120000.json', bytes: 120, made: '2026-11-07T12:00:00Z' }
let state: AutoBackups
let settings: Settings
const saveSettings = vi.fn((s: Settings) => Promise.resolve({ ...settings, ...s }))
const autoBackup = vi.fn((_name: string) => Promise.resolve('{"jobs":[]}'))
const replaceConfig = vi.fn((_doc: string) => Promise.resolve({ jobs: 0 }))

vi.mock('../../lib/api', async (actual) => ({
  ...(await actual<typeof import('../../lib/api')>()),
  api: {
    settings: () => Promise.resolve(settings),
    saveSettings: (s: Settings) => saveSettings(s),
    autoBackups: () => Promise.resolve(state),
    autoBackup: (name: string) => autoBackup(name),
    replaceConfig: (doc: string) => replaceConfig(doc),
  },
}))
vi.mock('../../lib/toast', () => ({ useToast: () => () => {} }))

const { AutoBackupCard } = await import('./AutoBackupCard')

beforeEach(() => {
  settings = {}
  state = { on: true, folder: '/config/backups', files: [latest], last: null }
  saveSettings.mockClear()
  autoBackup.mockClear()
  replaceConfig.mockClear()
})
afterEach(cleanup)

describe('the automatic backups card', () => {
  it('starts on, with a week of daily backups beside the settings', async () => {
    render(<AutoBackupCard hueIndex={0} />)
    const toggle = await screen.findByRole('switch', { name: 'Back up automatically' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect((screen.getByRole('spinbutton', { name: 'Days between backups' }) as HTMLInputElement).value).toBe('1')
    expect((screen.getByRole('spinbutton', { name: 'Backups to keep' }) as HTMLInputElement).value).toBe('7')
    expect((screen.getByRole('textbox', { name: 'Backup folder' }) as HTMLInputElement).placeholder).toBe(
      '/config/backups',
    )
  })

  it('saves the switch when it is turned off', async () => {
    render(<AutoBackupCard hueIndex={0} />)
    const toggle = await screen.findByRole('switch', { name: 'Back up automatically' })
    await act(async () => {
      fireEvent.click(toggle)
    })
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ autoBackup: { off: true } }), { timeout: 2000 })
    expect(screen.queryByRole('spinbutton', { name: 'Backups to keep' })).toBeNull()
  })

  it('shows when the latest backup was made', async () => {
    render(<AutoBackupCard hueIndex={0} />)
    const when = await screen.findByTitle(new Date(latest.made).toLocaleString('en'))
    expect(when).toBeTruthy()
  })

  it('puts the latest backup back through the import, after asking', async () => {
    render(<AutoBackupCard hueIndex={0} />)
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Restore' }))
    })
    expect(replaceConfig).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('kept as a backup of its own first')
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Restore' }).at(-1)!)
    })
    await waitFor(() => expect(replaceConfig).toHaveBeenCalledWith('{"jobs":[]}'))
    expect(autoBackup).toHaveBeenCalledWith(latest.name)
  })

  it('says so when there is no backup yet', async () => {
    state = { ...state, files: [] }
    render(<AutoBackupCard hueIndex={0} />)
    expect(await screen.findByText('None yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull()
  })

  it('tells when the last backup failed', async () => {
    state = { ...state, last: { at: latest.made, error: 'the disk is full' } }
    render(<AutoBackupCard hueIndex={0} />)
    expect(await screen.findByText(/the disk is full/)).toBeTruthy()
  })
})
