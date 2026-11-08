// @vitest-environment jsdom
// One Import button takes our own backup and the files of FolderSync and
// luckyBackup. The cases worth guarding: the other programs' files show what
// they add before anything is saved, and our own backup still asks before it
// replaces everything.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const checkImport = vi.fn()
const applyImport = vi.fn()
const replaceConfig = vi.fn()
vi.mock('../../lib/api', async (original) => ({
  ...(await original<typeof import('../../lib/api')>()),
  api: {
    checkImport: (file: string) => checkImport(file),
    applyImport: (file: string) => applyImport(file),
    replaceConfig: (doc: string) => replaceConfig(doc),
    rawConfig: vi.fn(),
  },
}))

const picked = vi.fn()
vi.mock('../../lib/download', async (original) => ({
  ...(await original<typeof import('../../lib/download')>()),
  pickTextFile: (accept: string) => picked(accept),
}))

import { ApiError } from '../../lib/api'
import { en } from '../../lib/i18n'
import type { ImportPlan } from '../../lib/importPlan'
import { BackupCard } from './BackupCard'

const profile = { name: 'home.profile', text: '***** luckyBackup *****' }
const plan: ImportPlan = {
  source: 'luckyBackup',
  jobs: [{ name: 'Documents', left: '/home/reeve/Documents', right: 'nas:/backup', direction: 'leftToRight' }],
  targets: [{ name: 'nas', type: 'sftp', settings: { host: 'nas.lan' } }],
  fillIn: [{ subject: 'nas', what: 'password' }],
  skipped: [{ subject: 'Documents', what: 'ExecuteBeforeListItem: mount /mnt/backup' }],
}

beforeEach(() => {
  for (const f of [checkImport, applyImport, replaceConfig, picked]) f.mockReset()
})
afterEach(cleanup)

async function importFile() {
  render(<BackupCard hueIndex={0} />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en['backup.import']) }))
  })
}

describe('the backup card', () => {
  it('holds Export and Import side by side in one row, with no row labels of their own', () => {
    render(<BackupCard hueIndex={0} />)
    const row = screen.getByTestId('backup-buttons')
    const names = Array.from(row.querySelectorAll('button')).map((b) => b.textContent)
    expect(names).toEqual([en['backup.export'], en['backup.import']])
    expect(row.className).toContain('flex-wrap')
    expect(document.querySelector('[data-glim-label]')).toBeNull()
  })
})

describe('the one Import button', () => {
  it('offers the files of the other programs as well as our own', async () => {
    picked.mockResolvedValue(null)
    await importFile()
    const accept = picked.mock.calls[0][0] as string
    expect(accept).toContain('.json')
    expect(accept).toContain('.profile')
    expect(screen.queryByText(en['backup.importOthers'])).toBeNull()
    expect(screen.getByLabelText(`${en['backup.hint']} ${en['backup.importOthers']}`)).toBeTruthy()
  })

  it('shows what a luckyBackup profile adds and saves only when asked', async () => {
    picked.mockResolvedValue(profile)
    checkImport.mockResolvedValue(plan)
    applyImport.mockResolvedValue(plan)
    await importFile()

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Import from luckyBackup')
    expect(dialog.textContent).toContain('Documents: /home/reeve/Documents → nas:/backup')
    expect(dialog.textContent).toContain('nas (sftp)')
    expect(dialog.textContent).toContain('nas: type the password again under Targets')
    expect(dialog.textContent).toContain('Documents: ExecuteBeforeListItem: mount /mnt/backup')
    expect(checkImport).toHaveBeenCalledWith(profile.text)
    expect(applyImport).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${en['import.add']}$`) }))
    })
    await waitFor(() => expect(applyImport).toHaveBeenCalledWith(profile.text))
    expect(replaceConfig).not.toHaveBeenCalled()
  })

  it('adds nothing when the preview is cancelled', async () => {
    picked.mockResolvedValue(profile)
    checkImport.mockResolvedValue(plan)
    await importFile()
    await screen.findByRole('dialog')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(en['confirm.cancel']) }))
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(applyImport).not.toHaveBeenCalled()
  })

  it('still asks before an ArrowLoop backup replaces everything', async () => {
    const backup = { name: 'arrowloop-2026-11-07.json', text: '{"jobs":[]}' }
    picked.mockResolvedValue(backup)
    checkImport.mockResolvedValue({ source: 'ArrowLoop', jobs: [], targets: [], fillIn: [], skipped: [] })
    await importFile()

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain(en['backup.confirm'].replace('{file}', backup.name))
    expect(applyImport).not.toHaveBeenCalled()
  })

  it('says which files it takes when it cannot read one', async () => {
    picked.mockResolvedValue({ name: 'notes.txt', text: 'hello' })
    checkImport.mockRejectedValue(new ApiError('cannot read', 400, 'import-unknown'))
    await importFile()
    expect(await screen.findByText(en['import.unknown'])).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says so when a file brings nothing to add, and still names what it left out', async () => {
    picked.mockResolvedValue(profile)
    checkImport.mockResolvedValue({ ...plan, jobs: [], targets: [], fillIn: [], skipped: [{ subject: 'Music', what: 'RemoteModule' }] })
    await importFile()
    expect(await screen.findByText(en['import.nothing'])).toBeTruthy()
    expect(screen.getByText('Music: RemoteModule')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
