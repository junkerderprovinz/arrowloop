// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AutoBackups, Settings } from '../../lib/api'

const latest = { name: 'arrowloop-auto-20261107-120000.json', bytes: 120, made: '2026-11-07T12:00:00Z' }
let state: AutoBackups
let settings: Settings
const saveSettings = vi.fn((s: Settings) => Promise.resolve({ ...settings, ...s }))
const browse = vi.fn((path?: string) =>
  Promise.resolve(
    path === '/data'
      ? { path: '/data', parent: '', entries: [{ name: 'copies', path: '/data/copies' }] }
      : { path: '', parent: '', entries: [{ name: '/data', path: '/data' }] },
  ),
)

vi.mock('../../lib/api', async (actual) => ({
  ...(await actual<typeof import('../../lib/api')>()),
  api: {
    settings: () => Promise.resolve(settings),
    saveSettings: (s: Settings) => saveSettings(s),
    autoBackups: () => Promise.resolve(state),
    browse: (path?: string) => browse(path),
  },
}))
vi.mock('../../lib/toast', () => ({ useToast: () => () => {} }))

const { AutoBackupCard } = await import('./AutoBackupCard')

beforeEach(() => {
  settings = {}
  state = { on: true, folder: '/config/backups', files: [latest], last: null }
  saveSettings.mockClear()
  browse.mockClear()
})
afterEach(cleanup)

describe('the automatic backups card', () => {
  it('starts on, with a week of daily backups beside the settings', async () => {
    render(<AutoBackupCard hueIndex={0} />)
    const toggle = await screen.findByRole('switch', { name: 'Back up automatically' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect((screen.getByRole('spinbutton', { name: 'Days between backups' }) as HTMLInputElement).value).toBe('1')
    expect((screen.getByRole('spinbutton', { name: 'Backups to keep' }) as HTMLInputElement).value).toBe('7')
    expect(screen.getByRole('button', { name: 'Time of day: 03:00' })).toBeTruthy()
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

  it('saves the time of day picked', async () => {
    settings = { autoBackup: { at: '22:30' } }
    render(<AutoBackupCard hueIndex={0} />)
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Time of day: 22:30' }))
    })
    const [hours] = screen.getAllByRole('listbox', { name: 'Time of day' })
    await act(async () => {
      fireEvent.click(within(hours).getByRole('option', { name: '05' }))
    })
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ autoBackup: { at: '05:30' } }), { timeout: 2000 })
  })

  it('hides the time of day while the backups are off', async () => {
    settings = { autoBackup: { off: true } }
    render(<AutoBackupCard hueIndex={0} />)
    await screen.findByRole('switch', { name: 'Back up automatically' })
    expect(screen.queryByRole('button', { name: /^Time of day/ })).toBeNull()
  })

  it('shows when the latest backup was made', async () => {
    render(<AutoBackupCard hueIndex={0} />)
    const when = await screen.findByTitle(new Date(latest.made).toLocaleString('en'))
    expect(when).toBeTruthy()
  })

  it('picks the folder in the folder picker', async () => {
    render(<AutoBackupCard hueIndex={0} />)
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Choose a folder' }))
    })
    const picker = await screen.findByRole('dialog', { name: 'Choose a folder' })
    await waitFor(() => expect(browse).toHaveBeenCalledWith('/config/backups'))
    await act(async () => {
      fireEvent.click(await within(picker).findByRole('button', { name: /\/data/ }))
    })
    await within(picker).findByText('copies')
    await act(async () => {
      fireEvent.click(within(picker).getByRole('button', { name: 'Use this folder' }))
    })
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ autoBackup: { folder: '/data' } }), { timeout: 2000 })
  })

  it('offers no restore, since Import settings puts a copy back', async () => {
    render(<AutoBackupCard hueIndex={0} />)
    await screen.findByTitle(new Date(latest.made).toLocaleString('en'))
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull()
  })

  it('says so when there is no backup yet', async () => {
    state = { ...state, files: [] }
    render(<AutoBackupCard hueIndex={0} />)
    expect(await screen.findByText('None yet')).toBeTruthy()
  })

  it('tells when the last backup failed', async () => {
    state = { ...state, last: { at: latest.made, error: 'the disk is full' } }
    render(<AutoBackupCard hueIndex={0} />)
    expect(await screen.findByText(/the disk is full/)).toBeTruthy()
  })
})
