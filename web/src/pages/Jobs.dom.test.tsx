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

describe('the head of the jobs page', () => {
  it('says everything is in sync and shows no waiting card when nothing waits', async () => {
    page()
    expect((await screen.findByTestId('status-head')).textContent).toBe('Everything in sync')
    expect(screen.queryByText('Waiting')).toBeNull()
  })

  it('is not in sync while an enabled job has never run, and names it', async () => {
    page({ jobs: [job('photos', { recent: [] })] })
    expect((await screen.findByTestId('status-head')).textContent).toBe('In sync, with notes')
    fireEvent.click(screen.getByText('photos has not run yet'))
    expect(opened).toHaveBeenCalledWith('photos')
  })

  it('needs the person for a conflict and a held job, each leading to where it is answered', async () => {
    const held: Finding = {
      id: 'f1', job: 'music', kind: 'delete', severity: 'critical', held: true, since: '', seen: '', open: true,
    }
    page({ findings: [held], conflicts: [{ job: 'photos' }, { job: 'photos' }, { job: 'music' }] })
    expect((await screen.findByTestId('status-head')).textContent).toBe('Needs you')
    expect(screen.getByText('Waiting')).toBeTruthy()

    fireEvent.click(screen.getByText('Conflicts waiting for a choice'))
    expect(went).toHaveBeenLastCalledWith({ tab: 'conflicts', job: '' })
    fireEvent.click(screen.getByText('music is held: Mass deletion'))
    expect(went).toHaveBeenLastCalledWith({ tab: 'anomalies', job: 'music', finding: 'f1' })
  })
})

describe('a job row', () => {
  it('carries only pause and run as its buttons, and opens the job anywhere else', async () => {
    page()
    await screen.findAllByRole('button', { name: 'Pause' })
    const photos = row('photos')
    const actions = photos.querySelector('.glim-row-actions') as HTMLElement
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

describe('the list bar', () => {
  it('keeps only the jobs that need a look under that filter', async () => {
    page({ jobs: [job('photos'), job('music', { recent: [ran('music', 'boom')] })] })
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Filter' })).getByRole('tab', { name: 'Problems' }))
    expect(screen.getAllByTestId('job-row').map((r) => r.textContent)).toEqual([expect.stringContaining('music')])
  })

  it('finds a job by a folder it syncs', async () => {
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'nas:mus' } })
    expect(screen.getAllByTestId('job-row')).toHaveLength(1)
    expect(screen.getByText('music')).toBeTruthy()
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
