// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, type Job, type OtherInstance, type RawJob } from '../lib/api'
import { ToastProvider } from '../lib/toast'

const CELLAR = 'c'.repeat(40)

const raw = (): RawJob => ({ name: 'Photos', left: '/mnt/user/photos', right: 'vault:photos', state: 'state/Photos.db' })

const photos: Job = {
  name: 'Photos',
  left: '/mnt/user/photos',
  right: 'vault:photos',
  direction: 'both',
  schedule: '0 3 * * *',
  watch: false,
  disabled: false,
  running: false,
  lastSuccess: null,
  recent: [],
}
const cellar: OtherInstance = { id: CELLAR, name: 'Cellar', deployment: 'container', state: 'ok', jobs: [photos] }

const instances = vi.fn()
const instanceJob = vi.fn()
const saveInstanceJob = vi.fn()
const instancePlaces = vi.fn()
const browseOnInstance = vi.fn()
const browse = vi.fn()
const settings = vi.fn()
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: {
    instances: () => instances(),
    instanceJob: (id: string, name: string) => instanceJob(id, name),
    saveInstanceJob: (id: string, name: string, job: RawJob) => saveInstanceJob(id, name, job),
    instancePlaces: (id: string) => instancePlaces(id),
    browseOnInstance: (id: string, path?: string) => browseOnInstance(id, path),
    browse: (path?: string) => browse(path),
    settings: () => settings(),
    runOnInstance: () => Promise.resolve({}),
    stopOnInstance: () => Promise.resolve({}),
  },
}))

import { RemoteJob } from './RemoteJob'

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

beforeEach(() => {
  for (const f of [instances, instanceJob, saveInstanceJob, instancePlaces, browseOnInstance, browse, settings]) f.mockReset()
  instances.mockResolvedValue([cellar])
  instanceJob.mockResolvedValue({ job: raw(), defaults: {} })
  instancePlaces.mockResolvedValue({ targets: [{ name: 'vault', type: 'sftp' }], drives: [], excludeSets: ['media'] })
  browseOnInstance.mockResolvedValue({ path: '/mnt/user', parent: '/mnt', entries: [{ name: 'photos', path: '/mnt/user/photos' }] })
})
afterEach(cleanup)

function page() {
  render(
    <ToastProvider>
      <RemoteJob instance={CELLAR} name="Photos" back="/instances" />
    </ToastProvider>,
  )
}

async function openEditor() {
  page()
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  return screen.findByRole('dialog', { name: 'Edit Photos on Cellar' })
}

describe('a job of another instance', () => {
  it('opens as a job page marked with the instance it belongs to', async () => {
    page()
    expect(await screen.findByRole('heading', { level: 1, name: 'Photos' })).toBeTruthy()
    expect(screen.getByText('On Cellar')).toBeTruthy()
    expect(instanceJob).toHaveBeenCalledWith(CELLAR, 'Photos')
  })

  it('saves its changes on the instance it belongs to', async () => {
    saveInstanceJob.mockImplementation((_id: string, _name: string, job: RawJob) => Promise.resolve({ job, defaults: {} }))
    const dialog = await openEditor()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Left side' }), { target: { value: '/mnt/user/pictures' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(saveInstanceJob).toHaveBeenCalledWith(CELLAR, 'Photos', expect.objectContaining({ name: 'Photos', left: '/mnt/user/pictures' })),
    )
    expect(await screen.findByText('Saved on Cellar.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Photos on Cellar' })).toBeNull())
  })

  it('keeps the editor open with what the instance refused', async () => {
    saveInstanceJob.mockRejectedValue(new Error('job "Photos" schedule "every tuesday": expected exactly 5 fields'))
    const dialog = await openEditor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/expected exactly 5 fields/)).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Edit Photos on Cellar' })).toBeTruthy()
  })

  it('says in the reader\'s words why the instance refused a side', async () => {
    saveInstanceJob.mockRejectedValue(new ApiError('refused', 400, 'group-side-share', { side: '\\\\nas\\photos', name: 'Cellar' }))
    const dialog = await openEditor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Network shares are chosen on Cellar itself, so \\\\nas\\photos cannot be set from here.')).toBeTruthy()
  })

  it('says why the name and sides of a job with commands stay as they are', async () => {
    saveInstanceJob.mockRejectedValue(new ApiError('refused', 400, 'group-commands', { side: '', name: 'Cellar' }))
    const dialog = await openEditor()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/runs commands before or after its runs on Cellar/)).toBeTruthy()
  })

  it('leaves the trash to the instance the job belongs to', async () => {
    const dialog = await openEditor()
    expect(within(dialog).queryByText('Keep a trash on each side')).toBeNull()
  })

  it('picks a folder among the folders of the instance it belongs to', async () => {
    const dialog = await openEditor()
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Browse targets' })[0])
    const picker = await screen.findByRole('dialog', { name: 'Choose a folder on Cellar' })
    await waitFor(() => expect(browseOnInstance).toHaveBeenCalledWith(CELLAR, '/mnt/user/photos'))
    expect(browse).not.toHaveBeenCalled()
    expect(within(picker).getByText('A configured target: vault')).toBeTruthy()
    expect(within(picker).queryByRole('button', { name: 'New folder' })).toBeNull()
  })

  it('offers the exclude sets of the instance it belongs to', async () => {
    const dialog = await openEditor()
    expect(await within(dialog).findByText('media')).toBeTruthy()
    expect(settings).not.toHaveBeenCalled()
  })

  it('asks to update an instance that cannot have its jobs edited yet', async () => {
    instanceJob.mockRejectedValue(new Error('no such address for the group: GET /api/jobs/Photos/config'))
    page()
    expect(await screen.findByText(/Cellar runs an older ArrowLoop/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Run now' })).toBeTruthy()
  })

  it('says so when the instance is not there', async () => {
    instances.mockResolvedValue([{ id: CELLAR, name: 'Cellar', deployment: 'container', state: 'away', lastSeen: 0 }])
    instanceJob.mockRejectedValue(new Error('no instance of the group goes by that id right now'))
    page()
    expect(await screen.findByText(/Not reachable/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })
})
