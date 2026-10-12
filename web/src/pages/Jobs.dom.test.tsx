// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Finding } from '../lib/anomalies'
import type { Job, RawJob, Run } from '../lib/api'
import { GoTo } from '../lib/goTo'
import { OpenJob } from '../lib/openJob'
import { ToastProvider } from '../lib/toast'

const pair = (): RawJob[] => [
  { name: 'photos', left: 'D:/Photos', right: 'nas:photos', state: 'state/photos.db' },
  { name: 'music', left: 'D:/Music', right: 'nas:music', state: 'state/music.db' },
]
const config = vi.fn(() => Promise.resolve({ jobs: pair() }))
const saveConfig = vi.fn((jobs: RawJob[]) => Promise.resolve({ jobs }))
const run = vi.fn((name: string) => Promise.resolve({ job: name, status: 'started' }))
const stopJob = vi.fn((_name: string) => Promise.resolve({ stopped: true }))

vi.mock('../lib/api', () => ({
  api: {
    config: () => config(),
    saveConfig: (jobs: RawJob[]) => saveConfig(jobs),
    settings: () => Promise.resolve({}),
    volumes: () => Promise.resolve({ volumes: [] }),
    remotes: () => Promise.resolve({ remotes: [], backends: [] }),
    run: (name: string) => run(name),
    stopJob: (name: string) => stopJob(name),
  },
}))

const { Jobs } = await import('./Jobs')
const { followSettings } = await import('../lib/anomalyModule')
const { LiveJobs } = await import('../lib/live')

// jsdom cannot measure elements, which the selectors and the corner ask for.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

function ran(job: string, err = ''): Run {
  const at = '2027-03-01T03:00:00Z'
  return {
    ID: 1, Job: job, Started: at, Finished: at, Copied: 1, Moved: 0, Trashed: 0, Conflicts: 0,
    DirsMade: 0, DirsRemoved: 0, Unchanged: 0, Skipped: 0, Err: err,
  }
}

function job(name: string, over: Partial<Job> = {}): Job {
  const raw = pair().find((j) => j.name === name)
  return {
    name,
    left: raw?.left ?? `D:/${name}`,
    right: raw?.right ?? `nas:${name}`,
    direction: 'both',
    schedule: '',
    watch: false,
    disabled: false,
    running: false,
    lastSuccess: null,
    recent: [ran(name)],
    ...over,
  }
}

const opened = vi.fn((_name: string) => undefined)
const went = vi.fn((_place: unknown) => undefined)

function page({ jobs = [job('photos'), job('music')], findings = [] as Finding[], conflicts = [] as { job: string }[] } = {}) {
  render(
    <ToastProvider>
      <GoTo.Provider value={went}>
        <OpenJob.Provider value={opened}>
          <Jobs jobs={jobs} findings={findings} progress={{}} conflicts={conflicts} onSaved={() => undefined} />
        </OpenJob.Provider>
      </GoTo.Provider>
    </ToastProvider>,
  )
}

const row = (name: string) => screen.getByText(name).closest('li') as HTMLElement

beforeEach(() => {
  localStorage.clear()
  config.mockReset()
  config.mockImplementation(() => Promise.resolve({ jobs: pair() }))
  saveConfig.mockReset()
  saveConfig.mockImplementation((jobs: RawJob[]) => Promise.resolve({ jobs }))
  run.mockClear()
  opened.mockClear()
  went.mockClear()
})
afterEach(cleanup)

describe('the jobs page', () => {
  it('opens on the jobs, with no status head and no waiting card', async () => {
    const held: Finding = {
      id: 'f1', job: 'music', kind: 'delete', severity: 'critical', held: true, since: '', seen: '', open: true,
    }
    page({ findings: [held], conflicts: [{ job: 'photos' }] })
    await screen.findAllByRole('button', { name: 'Pause' })
    expect(screen.queryByTestId('status-head')).toBeNull()
    expect(screen.queryByText('Waiting')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Filter' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
  })

  it('gives every job a card of its own, in name order', async () => {
    page()
    const rows = await screen.findAllByTestId('job-row')
    expect(rows.map((r) => r.querySelectorAll('.glim-notch-card').length)).toEqual([1, 1])
    expect(rows.map((r) => r.querySelector('h2')?.textContent)).toEqual(['music', 'photos'])
  })
})

describe('a job card', () => {
  it('carries only pause and run as its buttons, and opens the job anywhere else', async () => {
    page()
    await screen.findAllByRole('button', { name: 'Pause' })
    const photos = row('photos')
    const actions = within(photos).getByTestId('job-actions')
    expect(within(actions).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Pause', 'Run now'])

    fireEvent.click(photos)
    expect(opened).toHaveBeenCalledWith('photos')
    opened.mockClear()
    fireEvent.click(within(actions).getByRole('button', { name: 'Run now' }))
    expect(opened).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledWith('photos')
  })

  it('shows the last runs as a strip and keeps a run that worked quiet', async () => {
    page()
    const photos = row('photos')
    expect(within(photos).getByRole('img', { name: 'Last runs: worked: 1' })).toBeTruthy()
    expect(within(photos).queryByText('Failed')).toBeNull()
  })

  it('names a held run in the warn colour instead of the synced dot', async () => {
    const held: Finding = {
      id: 'f1', job: 'music', kind: 'delete', severity: 'critical', held: true, since: '', seen: '', open: true,
    }
    page({ findings: [held] })
    const status = within(row('music')).getByTestId('job-status')
    expect(status.textContent).toBe('Held')
    const badge = within(status).getByText('Held')
    expect(badge.className).toContain('text-statusWarn')
    expect(status.querySelector('.bg-statusOkSolid')).toBeNull()
    fireEvent.click(badge)
    expect(went).toHaveBeenLastCalledWith({ tab: 'anomalies', job: 'music', finding: 'f1' })
    expect(opened).not.toHaveBeenCalled()
  })

  it('answers a held run over the job while the anomaly notes are off', async () => {
    const held: Finding = {
      id: 'f1', job: 'music', kind: 'delete', severity: 'critical', held: true, since: '', seen: '', open: true,
    }
    followSettings({ anomalies: { off: true } })
    render(
      <ToastProvider>
        <GoTo.Provider value={went}>
          <OpenJob.Provider value={opened}>
            <LiveJobs.Provider value={{ jobs: [], findings: [held], conflicted: [], progress: {}, speeds: {}, onSaved: () => {} }}>
              <Jobs jobs={[job('music')]} findings={[held]} progress={{}} onSaved={() => undefined} />
            </LiveJobs.Provider>
          </OpenJob.Provider>
        </GoTo.Provider>
      </ToastProvider>,
    )
    fireEvent.click(within(row('music')).getByText('Held'))
    expect(await screen.findByRole('dialog', { name: 'music: Mass deletion' })).toBeTruthy()
    expect(went).not.toHaveBeenCalled()
    expect(opened).not.toHaveBeenCalled()
    followSettings({})
  })

  it('names a waiting conflict in the warn colour and leads to it, not to the job', async () => {
    page({ conflicts: [{ job: 'photos' }] })
    const status = within(row('photos')).getByTestId('job-status')
    expect(status.textContent).toBe('Conflict waiting')
    const badge = within(status).getByText('Conflict waiting')
    expect(badge.className).toContain('text-statusWarn')
    expect(status.querySelector('.bg-statusOkSolid')).toBeNull()
    expect(within(row('music')).getByTestId('job-status').querySelector('.bg-statusOkSolid')).toBeTruthy()
    fireEvent.click(badge)
    expect(went).toHaveBeenLastCalledWith({ tab: 'conflicts', job: 'photos' })
    expect(opened).not.toHaveBeenCalled()
  })

  it('never shows a run that skipped files as in sync', async () => {
    page({ jobs: [job('photos', { recent: [{ ...ran('photos'), Skipped: 2 }] }), job('music')] })
    const status = within(row('photos')).getByTestId('job-status')
    expect(status.textContent).toBe('Needs a look')
    expect(status.querySelector('.bg-statusOkSolid')).toBeNull()
  })

  it('gives a job a note speaks of no synced dot, and leads to the note', async () => {
    const note: Finding = {
      id: 'n1', job: 'music', kind: 'overdue', severity: 'warning', held: false, since: '', seen: '', open: true,
    }
    page({ findings: [note] })
    const status = within(row('music')).getByTestId('job-status')
    expect(status.querySelector('.bg-statusOkSolid')).toBeNull()
    fireEvent.click(within(status).getByText('Needs a look'))
    expect(went).toHaveBeenLastCalledWith({ tab: 'anomalies', job: 'music', finding: 'n1' })
  })

  it('says a job failed by its own last run', async () => {
    page({ jobs: [job('photos', { recent: [ran('photos', 'boom'), ran('photos')] })] })
    expect(within(row('photos')).getByText('Failed')).toBeTruthy()
  })

  it('offers cancel instead of run while the job runs', async () => {
    page({ jobs: [job('photos', { running: true })] })
    expect(within(row('photos')).getByRole('button', { name: 'Cancel the run' })).toBeTruthy()
    expect(within(row('photos')).queryByRole('button', { name: 'Run now' })).toBeNull()
  })

  it('says why a run could not be started', async () => {
    run.mockImplementationOnce(() => Promise.reject(new Error('this interface is password protected, log in first')))
    page()
    fireEvent.click(within(row('photos')).getByRole('button', { name: 'Run now' }))
    expect(await screen.findByText('this interface is password protected, log in first')).toBeTruthy()
  })

  it('writes only the paused job', async () => {
    page()
    await screen.findAllByRole('button', { name: 'Pause' })
    fireEvent.click(within(row('music')).getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(saveConfig).toHaveBeenCalled())
    const written = saveConfig.mock.calls[0][0]
    expect(written.find((j) => j.name === 'music')?.disabled).toBe(true)
    expect(written.find((j) => j.name === 'photos')?.disabled).toBeUndefined()
  })

  it('holds the pause buttons while a write is under way', async () => {
    saveConfig.mockImplementation(() => new Promise(() => undefined))
    page()
    await screen.findAllByRole('button', { name: 'Pause' })
    fireEvent.click(within(row('photos')).getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(saveConfig).toHaveBeenCalled())
    for (const button of screen.getAllByRole('button', { name: 'Pause' })) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })
})

describe('adding a job', () => {
  it('is the one filled button on the page', async () => {
    page()
    const add = await screen.findByRole('button', { name: 'Add a job' })
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
    expect(add.closest('[data-testid="page-actions"]')).toBeTruthy()
    const filled = screen.getAllByRole('button').filter((b) => b.className.split(' ').includes('bg-accent'))
    expect(filled).toEqual([add])
  })

  it('waits until the job list has loaded', async () => {
    config.mockImplementation(() => new Promise(() => undefined))
    page()
    const add = await screen.findByRole('button', { name: 'Add a job' })
    expect((add as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens the editor in a window, and Cancel drops the new job unsaved', async () => {
    page()
    const add = await screen.findByRole('button', { name: 'Add a job' })
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(add)
    const window = await screen.findByRole('dialog', { name: 'New job' })
    expect(within(window).getByDisplayValue('new-job')).toBeTruthy()
    fireEvent.click(within(window).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText('new-job')).toBeNull()
    expect(saveConfig).not.toHaveBeenCalled()
  })

  it('saves the new job from the window', async () => {
    page()
    const add = await screen.findByRole('button', { name: 'Add a job' })
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(add)
    const window = await screen.findByRole('dialog', { name: 'New job' })
    fireEvent.click(within(window).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saveConfig).toHaveBeenCalled())
    expect(saveConfig.mock.calls[0][0].map((j) => j.name)).toEqual(['photos', 'music', 'new-job'])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('the More menu beside Add a job', () => {
  it('runs every job that is ready, and only those', async () => {
    page({ jobs: [job('photos'), job('music', { disabled: true })] })
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Run all' }))
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    expect(run).toHaveBeenCalledWith('photos')
  })
})
