// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RawJob } from '../lib/api'
import { HostContext, type Host } from '../lib/host'

const config = vi.fn()
const saveConfig = vi.fn()
vi.mock('../lib/api', async (original) => {
  const real = await original<typeof import('../lib/api')>()
  return {
    ...real,
    api: {
      ...real.api,
      config: () => config(),
      saveConfig: (jobs: RawJob[]) => saveConfig(jobs),
    },
  }
})

import { JobForm } from './Editor'

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

afterEach(() => {
  cleanup()
  saved.mockReset()
  config.mockReset()
  saveConfig.mockReset()
})

const LISTS = { Photos: ['*.jpg', '*.heic'], Videos: [], junk: ['Thumbs.db'] }
const OTHERS: RawJob[] = [{ name: 'rest', left: '/a', right: '/c', state: 'rest.db', excludeSets: ['Photos'] }]
const saved = vi.fn()

const host: Host = {
  browse: () => Promise.resolve({ path: '/', parent: '', entries: [] }),
  excludeSets: () => Promise.resolve(Object.keys(LISTS)),
  sharedLists: () => Promise.resolve({ sets: LISTS, jobs: OTHERS }),
  saveSharedLists: (sets) => {
    saved(sets)
    return Promise.resolve()
  },
}

function form(job: RawJob) {
  const patch = vi.fn()
  render(
    <HostContext.Provider value={host}>
      <JobForm job={job} known={[]} remotes={[]} patch={patch} follows={false} onHeld={() => {}} />
    </HostContext.Provider>,
  )
  return patch
}

const base: RawJob = { name: 'camera', left: '/a', right: '/b', state: 'camera.db' }

async function openSide(name: 'Inclusions' | 'Exclusions') {
  const field = await screen.findByRole('combobox', { name })
  fireEvent.click(field)
  return screen.findByRole('listbox', { name })
}

describe('shared lists in the job form', () => {
  it('does not offer a list to include that the job already excludes', async () => {
    form({ ...base, excludeSets: ['junk'] })
    const list = await openSide('Inclusions')
    const names = within(list).getAllByRole('option').map((o) => o.textContent)
    expect(names).toEqual(['Photos', 'Videos', 'New list…'])
  })

  it('passes a list picked to include on as the job\'s include lists', async () => {
    const patch = form({ ...base })
    const field = await screen.findByRole('combobox', { name: 'Inclusions' })
    field.focus()
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    await waitFor(() => expect(field.getAttribute('aria-activedescendant')).toBeTruthy())
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ includeSets: ['Photos'], excludeSets: undefined }))
  })

  it('shows each picked list as a tag that can be taken away', async () => {
    const patch = form({ ...base, includeSets: ['Photos'] })
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Photos' }))
    expect(patch).toHaveBeenCalledWith({ includeSets: undefined, excludeSets: undefined })
  })

  it('warns when the only lists the job includes are empty', async () => {
    form({ ...base, includeSets: ['Videos'] })
    expect(await screen.findByText(/this job takes no files/)).toBeTruthy()
  })

  it('says nothing while an included list has patterns', async () => {
    form({ ...base, includeSets: ['Photos'] })
    await screen.findByRole('combobox', { name: 'Inclusions' })
    expect(screen.queryByText(/this job takes no files/)).toBeNull()
  })

  it('shows the patterns of each picked list under the field', async () => {
    form({ ...base, includeSets: ['Photos'] })
    expect(await screen.findByDisplayValue(/\*\.jpg\s+\*\.heic/)).toBeTruthy()
  })

  it('saves an edited list to the shared lists and says how many jobs it changes', async () => {
    const patch = form({ ...base, includeSets: ['Photos'] })
    const box = await screen.findByDisplayValue(/\*\.jpg\s+\*\.heic/)
    fireEvent.change(box, { target: { value: '*.jpg\n*.png' } })
    expect(await screen.findByText(/every job with this list: 2/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save list' }))
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ ...LISTS, Photos: ['*.jpg', '*.png'] }))
    expect(patch).not.toHaveBeenCalled()
  })

  it('creates a list from the dropdown and picks it', async () => {
    const patch = form({ ...base })
    const field = await screen.findByRole('combobox', { name: 'Inclusions' })
    field.focus()
    for (let i = 0; i < 4; i++) {
      const was = field.getAttribute('aria-activedescendant')
      fireEvent.keyDown(field, { key: 'ArrowDown' })
      await waitFor(() => expect(field.getAttribute('aria-activedescendant')).not.toBe(was))
    }
    fireEvent.keyDown(field, { key: 'Enter' })
    const name = await screen.findByPlaceholderText('Name for a new list')
    fireEvent.change(name, { target: { value: 'Raw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add this list' }))
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ ...LISTS, Raw: [] }))
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ includeSets: ['Raw'], excludeSets: undefined }))
  })

  it('manages the lists in a window over the form, so nothing picked there is lost', async () => {
    const before = window.location.pathname
    const patch = form({ ...base, includeSets: ['Photos'] })
    fireEvent.click((await screen.findAllByRole('button', { name: 'Manage lists' }))[0]!)
    const dialog = await screen.findByRole('dialog', { name: 'Shared lists' })
    expect(window.location.pathname).toBe(before)
    fireEvent.change(within(dialog).getByDisplayValue('Thumbs.db'), { target: { value: 'Thumbs.db\ndesktop.ini' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ ...LISTS, junk: ['Thumbs.db', 'desktop.ini'] }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(patch).not.toHaveBeenCalled()
  })

  it('hands a list removed in that window over to the job being edited', async () => {
    config.mockResolvedValue({ jobs: OTHERS })
    saveConfig.mockImplementation((jobs: RawJob[]) => Promise.resolve({ jobs }))
    const patch = form({ ...base, includeSets: ['Photos'] })
    fireEvent.click((await screen.findAllByRole('button', { name: 'Manage lists' }))[0]!)
    const dialog = await screen.findByRole('dialog', { name: 'Shared lists' })
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Remove this list' })[0]!)
    expect(await screen.findByText(/Jobs that use this list: 2/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove this list' }).at(-1)!)
    await waitFor(() =>
      expect(saveConfig).toHaveBeenCalledWith([{ ...OTHERS[0], exclude: ['*.jpg', '*.heic'], excludeSets: undefined }]),
    )
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(expect.objectContaining({ include: ['*.jpg', '*.heic'], includeSets: undefined })),
    )
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ Videos: [], junk: ['Thumbs.db'] }))
  })
})
