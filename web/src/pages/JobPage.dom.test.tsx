// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Job, RawJob, Run } from '../lib/api'
import { GoTo } from '../lib/goTo'
import { LiveJobs } from '../lib/live'
import { ToastProvider } from '../lib/toast'

const pair = (): RawJob[] => [
  { name: 'photos', left: 'D:/Photos', right: 'nas:photos', state: 'state/photos.db' },
  { name: 'music', left: 'D:/Music', right: 'nas:music', state: 'state/music.db' },
]
const config = vi.fn(() => Promise.resolve({ jobs: pair() }))
const saveConfig = vi.fn((jobs: RawJob[]) => Promise.resolve({ jobs }))
const forgetJobState = vi.fn((_name: string) => Promise.resolve({}))

vi.mock('../lib/api', () => ({
  api: {
    config: () => config(),
    saveConfig: (jobs: RawJob[]) => saveConfig(jobs),
    settings: () => Promise.resolve({}),
    volumes: () => Promise.resolve({ volumes: [] }),
    remotes: () => Promise.resolve({ remotes: [], backends: [] }),
    history: () => Promise.resolve([] as Run[]),
    jobTouches: () => Promise.resolve([]),
    historyStats: () => Promise.reject(new Error('none')),
    forgetJobState: (name: string) => forgetJobState(name),
    run: () => Promise.resolve({}),
    stopJob: () => Promise.resolve({}),
  },
}))

const { JobPage } = await import('./JobPage')

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

function job(name: string): Job {
  const raw = pair().find((j) => j.name === name)!
  return {
    name, left: raw.left!, right: raw.right!, direction: 'both', schedule: '', watch: false,
    disabled: false, running: false, lastSuccess: null, recent: [],
  }
}

const went = vi.fn((_place: unknown) => undefined)

function page(name = 'photos', conflicted: string[] = []) {
  render(
    <ToastProvider>
      <GoTo.Provider value={went}>
        <LiveJobs.Provider
          value={{ jobs: [job('photos'), job('music')], findings: [], conflicted, progress: {}, speeds: {}, onSaved: () => undefined }}
        >
          <JobPage name={name} />
        </LiveJobs.Provider>
      </GoTo.Provider>
    </ToastProvider>,
  )
}

beforeEach(() => {
  config.mockImplementation(() => Promise.resolve({ jobs: pair() }))
  saveConfig.mockReset()
  saveConfig.mockImplementation((jobs: RawJob[]) => Promise.resolve({ jobs }))
  went.mockClear()
})
afterEach(cleanup)

describe('a job page', () => {
  it('opens with a flat head whose one filled button runs the job', async () => {
    page()
    expect(await screen.findByRole('heading', { level: 1, name: 'photos' })).toBeTruthy()
    await screen.findByRole('button', { name: 'Edit' })
    const filled = screen.getAllByRole('button').filter((b) => b.className.split(' ').includes('bg-accent'))
    expect(filled.map((b) => b.textContent?.trim())).toEqual(['Run now'])
  })

  it('has a card for each thing it does, none of them folded', async () => {
    page()
    for (const title of ['Runs', 'Files touched', 'Preview', 'Check this job', 'Find duplicates']) {
      expect(await screen.findByRole('heading', { level: 2, name: new RegExp(`^${title}`) })).toBeTruthy()
    }
    expect(document.querySelector('[aria-expanded="false"]:not([aria-haspopup])')).toBeNull()
  })

  it('edits the job in a window that keeps its name while it is retyped', async () => {
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const window = await screen.findByRole('dialog', { name: 'Edit photos' })
    const name = within(window).getByDisplayValue('photos') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'photosx' } })
    expect(screen.getByRole('dialog', { name: 'Edit photos' })).toBeTruthy()
    expect(name.value).toBe('photosx')
  })

  it('puts the entry back when the edit is cancelled', async () => {
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const window = await screen.findByRole('dialog', { name: 'Edit photos' })
    fireEvent.change(within(window).getByDisplayValue('nas:photos'), { target: { value: 'nas:elsewhere' } })
    fireEvent.click(within(window).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(within(await screen.findByRole('dialog')).getByDisplayValue('nas:photos')).toBeTruthy()
  })

  it('removes only this job from More and goes back to the list', async () => {
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'More' }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(saveConfig).toHaveBeenCalled())
    expect(saveConfig.mock.calls[0][0]).toEqual([pair()[1]])
    await waitFor(() => expect(went).toHaveBeenCalledWith({ tab: 'jobs', job: '' }))
  })

  it('names a waiting conflict in its head and leads to it', async () => {
    page('photos', ['photos'])
    fireEvent.click(await screen.findByRole('button', { name: 'Conflict waiting' }))
    expect(went).toHaveBeenCalledWith({ tab: 'conflicts', job: 'photos' })
  })

  it('says so when no job has the name', async () => {
    page('films')
    expect(await screen.findByText('There is no job by this name.')).toBeTruthy()
  })
})
