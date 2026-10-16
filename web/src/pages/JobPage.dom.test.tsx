// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Finding } from '../lib/anomalies'
import type { Job, RawJob, Run } from '../lib/api'
import { GoTo } from '../lib/goTo'
import { LiveJobs } from '../lib/live'
import type { JobLearning } from '../lib/anomalies'
import { ToastProvider } from '../lib/toast'

const pair = (): RawJob[] => [
  { name: 'photos', left: 'D:/Photos', right: 'nas:photos', state: 'state/photos.db' },
  { name: 'music', left: 'D:/Music', right: 'nas:music', state: 'state/music.db' },
]
const config = vi.fn(() => Promise.resolve({ jobs: pair() }))
const saveConfig = vi.fn((jobs: RawJob[]) => Promise.resolve({ jobs }))
const forgetJobState = vi.fn((_name: string) => Promise.resolve({}))

const learning = vi.fn(() => Promise.resolve([] as JobLearning[]))
const checkJob = vi.fn((_name: string) => Promise.resolve({ ok: true, findings: [] }))

vi.mock('../lib/api', () => ({
  api: {
    config: () => config(),
    saveConfig: (jobs: RawJob[]) => saveConfig(jobs),
    settings: () => Promise.resolve({}),
    learning: () => learning(),
    volumes: () => Promise.resolve({ volumes: [] }),
    remotes: () => Promise.resolve({ remotes: [], backends: [] }),
    history: () => Promise.resolve([] as Run[]),
    log: () => Promise.resolve([]),
    historyStats: () => Promise.reject(new Error('none')),
    forgetJobState: (name: string) => forgetJobState(name),
    checkJob: (name: string) => checkJob(name),
    verifyJob: () => Promise.resolve({ findings: [], truncated: false }),
    run: () => Promise.resolve({}),
    stopJob: () => Promise.resolve({ stopped: true }),
  },
}))

const { JobPage } = await import('./JobPage')
const { followSettings } = await import('../lib/anomalyModule')

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver
// jsdom does not lay out, so it has no scrolling to do either.
Element.prototype.scrollIntoView ??= () => undefined

function job(name: string): Job {
  const raw = pair().find((j) => j.name === name)!
  return {
    name, left: raw.left!, right: raw.right!, direction: 'both', schedule: '', watch: false,
    disabled: false, running: false, lastSuccess: null, recent: [],
  }
}

const went = vi.fn((_place: unknown) => undefined)
const saved = vi.fn()

function page(name = 'photos', conflicted: string[] = [], findings: Finding[] = []) {
  render(
    <ToastProvider>
      <GoTo.Provider value={went}>
        <LiveJobs.Provider
          value={{ jobs: [job('photos'), job('music')], findings, conflicted, progress: {}, speeds: {}, onSaved: saved }}
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

  it('says the run is stopping until it has stopped', async () => {
    render(
      <ToastProvider>
        <LiveJobs.Provider
          value={{ jobs: [{ ...job('photos'), running: true }], findings: [], conflicted: [], progress: {}, speeds: {}, onSaved: () => undefined }}
        >
          <JobPage name="photos" />
        </LiveJobs.Provider>
      </ToastProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel the run' }))
    const stopping = await screen.findByRole('button', { name: 'Stopping the run' })
    expect((stopping as HTMLButtonElement).disabled).toBe(true)
  })

  it('leads back to the jobs from its head', async () => {
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    expect(went).toHaveBeenCalledWith({ tab: 'jobs', job: '' })
  })

  it('lists the files touched with a filter and a search of their own', async () => {
    page()
    expect(await screen.findByRole('heading', { level: 2, name: /^Files touched/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy()
  })

  it('starts the check when the address asks for its card, then forgets the ask', async () => {
    window.history.replaceState(null, '', '/jobs/photos?card=check')
    page()
    await waitFor(() => expect(checkJob).toHaveBeenCalledWith('photos'))
    expect(window.location.search).toBe('')
    window.history.replaceState(null, '', '/')
  })

  it('has a card for each thing it does, none of them folded', async () => {
    page()
    for (const title of ['Runs', 'Files touched', 'Preview', 'Check', 'Duplicates']) {
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

  it('moves to the new address when the job is saved under a new name', async () => {
    window.history.replaceState(null, '', '/jobs/photos')
    const before = window.history.length
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const editor = await screen.findByRole('dialog', { name: 'Edit photos' })
    fireEvent.change(within(editor).getByDisplayValue('photos'), { target: { value: 'pictures' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(window.location.pathname).toBe('/jobs/pictures'))
    expect(window.history.length).toBe(before)
    window.history.replaceState(null, '', '/')
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

  it('shows the global brakes locked until one is overridden, then writes it into the entry', async () => {
    page()
    const [brake] = await screen.findAllByRole('button', { name: 'Override' })
    fireEvent.click(brake!)
    await waitFor(() => expect(saveConfig).toHaveBeenCalled())
    const written = saveConfig.mock.calls[0][0].find((j) => j.name === 'photos')
    expect(written?.brakePercent).toBe(50)
    expect(written?.changePercent).toBeUndefined()
    expect(saveConfig.mock.calls[0][0].find((j) => j.name === 'music')?.brakePercent).toBeUndefined()
  })

  it('gives an own brake back to the default only after asking', async () => {
    config.mockImplementation(() => Promise.resolve({ jobs: [{ ...pair()[0]!, brakePercent: 20 }, pair()[1]!] }))
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'Use the default' }))
    expect(saveConfig).not.toHaveBeenCalled()
    const ask = await screen.findByRole('dialog', { name: 'Use the default?' })
    expect(ask.textContent).toContain('currently 50 %')
    fireEvent.click(within(ask).getByRole('button', { name: 'Use the default' }))
    await waitFor(() => expect(saveConfig).toHaveBeenCalled())
    expect(saveConfig.mock.calls[0][0].find((j) => j.name === 'photos')).not.toHaveProperty('brakePercent', 20)
    expect(saveConfig.mock.calls[0][0].find((j) => j.name === 'photos')?.brakePercent).toBeUndefined()
  })

  it('edits an overridden schedule from its sentence', async () => {
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const editor = await screen.findByRole('dialog')
    const sentence = within(editor).getByRole('button', { name: /^Schedule:/ })
    expect(sentence.textContent).toContain('on request')
    expect(sentence.closest('[inert]')).not.toBeNull()

    const row = sentence.closest('[data-inherited]') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Override' }))
    const own = within(editor).getByRole('button', { name: /^Schedule:/ })
    expect(own.closest('[inert]')).toBeNull()
    fireEvent.click(own)
    const panel = await screen.findByRole('dialog', { name: 'Schedule' })
    fireEvent.click(within(panel).getByRole('tab', { name: 'Every day' }))
    expect(within(editor).getByRole('button', { name: /^Schedule:/ }).textContent).toContain('daily at')
  })

  it('answers a held run on the page while the anomaly notes are off', async () => {
    const held: Finding = { id: 'f1', job: 'photos', kind: 'delete', severity: 'critical', held: true, since: '2027-03-01T03:00:00Z', seen: '', open: true }
    followSettings({ anomalies: { off: true } })
    page('photos', [], [held])
    const card = (await screen.findByText('This run would delete 0 of 0 files (0 %, limit 0 %).')).closest('li') as HTMLElement
    expect(within(card).getByRole('button', { name: 'Take back' })).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Open job' })).toBeNull()
    const filled = screen.getAllByRole('button').filter((b) => b.className.split(' ').includes('bg-accent'))
    expect(filled.map((b) => b.textContent?.trim())).toEqual(['Run now'])
    followSettings({})
  })

  it('says what a run usually does once the job is learned', async () => {
    learning.mockImplementation(() =>
      Promise.resolve([
        {
          job: 'photos',
          runs: 12,
          usual: [
            { figure: 'deleted', low: 0, high: 6 },
            { figure: 'duration', low: 45, high: 150 },
          ],
        },
      ] as JobLearning[]),
    )
    page()
    expect(await screen.findByText('Files deleted per run: 0 to 6')).toBeTruthy()
    expect(screen.getByText('Time per run: 45 s to 3 min')).toBeTruthy()
    learning.mockImplementation(() => Promise.resolve([]))
  })

  it('shows no usual ranges while the job is still learning', async () => {
    learning.mockImplementation(() => Promise.resolve([{ job: 'photos', runs: 3 }]))
    page()
    await screen.findByRole('heading', { level: 1, name: 'photos' })
    await waitFor(() => expect(learning).toHaveBeenCalled())
    expect(screen.queryByText('Usual run')).toBeNull()
    learning.mockImplementation(() => Promise.resolve([]))
  })
})

describe('Run now on a job page', () => {
  it('asks for the jobs again once the engine has taken the run', async () => {
    saved.mockClear()
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(saved).toHaveBeenCalled())
  })
})
