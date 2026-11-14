// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Finding } from '../lib/anomalies'
import type { Job, RawJob, Run } from '../lib/api'
import { GoTo } from '../lib/goTo'
import { en } from '../lib/i18n.data'
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
const orderJobs = vi.fn((names: string[]) => Promise.resolve({ jobs: names.length }))

vi.mock('../lib/api', () => ({
  api: {
    config: () => config(),
    saveConfig: (jobs: RawJob[]) => saveConfig(jobs),
    settings: () => Promise.resolve({}),
    volumes: () => Promise.resolve({ volumes: [] }),
    remotes: () => Promise.resolve({ remotes: [], backends: [] }),
    run: (name: string) => run(name),
    stopJob: (name: string) => stopJob(name),
    orderJobs: (names: string[]) => orderJobs(names),
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
const saved = vi.fn()

function page({ jobs = [job('photos'), job('music')], findings = [] as Finding[], conflicts = [] as { job: string }[] } = {}) {
  render(
    <div className="glim-page-enter">
      <ToastProvider>
        <GoTo.Provider value={went}>
          <OpenJob.Provider value={opened}>
            <Jobs jobs={jobs} findings={findings} progress={{}} conflicts={conflicts} onSaved={saved} />
          </OpenJob.Provider>
        </GoTo.Provider>
      </ToastProvider>
    </div>,
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
  orderJobs.mockClear()
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

  it('gives every job a card of its own, in the order the engine lists them', async () => {
    page()
    const rows = await screen.findAllByTestId('job-row')
    expect(rows.map((r) => r.querySelectorAll('.glim-notch-card').length)).toEqual([1, 1])
    expect(rows.map((r) => r.querySelector('h2')?.textContent)).toEqual(['photos', 'music'])
  })
})

const shownOrder = () => screen.getAllByTestId('job-row').map((r) => r.getAttribute('data-job'))

describe('moving a job', () => {
  it('takes Alt and an arrow key on its handle, says where it went and writes the whole order', async () => {
    page()
    const handle = await screen.findByRole('button', { name: 'Move music' })
    fireEvent.keyDown(handle, { key: 'ArrowUp', altKey: true })
    expect(shownOrder()).toEqual(['music', 'photos'])
    expect(screen.getByText('Moved music to place 1')).toBeTruthy()
    await waitFor(() => expect(orderJobs).toHaveBeenCalledWith(['music', 'photos']))
    await waitFor(() => expect(saved).toHaveBeenCalled())
  })

  it('takes the same keys on the card itself', async () => {
    page()
    await screen.findAllByRole('button', { name: 'Pause' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'photos' }), { key: 'ArrowDown', altKey: true })
    expect(shownOrder()).toEqual(['music', 'photos'])
  })

  it('writes nothing for a move past either end', async () => {
    page()
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Move photos' }), { key: 'ArrowUp', altKey: true })
    expect(orderJobs).not.toHaveBeenCalled()
    expect(shownOrder()).toEqual(['photos', 'music'])
  })

  it('puts the jobs back when the engine refuses the order', async () => {
    orderJobs.mockImplementationOnce(() => Promise.reject(new Error('the file is read-only')))
    page()
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Move music' }), { key: 'ArrowUp', altKey: true })
    await waitFor(() => expect(shownOrder()).toEqual(['photos', 'music']))
  })

  it('does not open the job from its handle', async () => {
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'Move music' }))
    expect(opened).not.toHaveBeenCalled()
  })
})

describe('the compact view', () => {
  // Chosen under Settings, Look, which keeps it in this browser.
  const compact = async () => {
    localStorage.setItem('arrowloop.jobs.view', JSON.stringify('compact'))
    page()
    await screen.findAllByTestId('job-row')
  }

  it('shows one row per job with its status, Run now and More, and no card', async () => {
    await compact()
    const rows = screen.getAllByTestId('job-row')
    expect(rows).toHaveLength(2)
    expect(document.querySelectorAll('[data-testid="job-row"] .glim-notch-card')).toHaveLength(0)
    const actions = within(row('photos')).getByTestId('job-actions')
    expect(within(actions).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['More', 'Run now'])
    expect(within(row('photos')).getByTestId('job-status')).toBeTruthy()
  })

  it('opens the job from its row', async () => {
    await compact()
    fireEvent.click(row('music'))
    expect(opened).toHaveBeenCalledWith('music')
  })

  it('keeps Pause in More', async () => {
    await compact()
    fireEvent.click(within(row('photos')).getByRole('button', { name: 'More' }))
    expect(await screen.findByRole('menuitem', { name: 'Pause' })).toBeTruthy()
  })

  it('moves a job with the keyboard as the cards do', async () => {
    await compact()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move music' }), { key: 'ArrowUp', altKey: true })
    expect(shownOrder()).toEqual(['music', 'photos'])
  })

  it('leaves the switch to Settings, Look', async () => {
    page()
    await screen.findAllByTestId('job-row')
    expect(screen.queryByRole('tab', { name: 'Compact' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Cards' })).toBeNull()
  })
})

describe('a job card', () => {
  it('carries More, Pause and Run now in that order, and opens the job anywhere else', async () => {
    page()
    await screen.findAllByRole('button', { name: 'Pause' })
    const photos = row('photos')
    const actions = within(photos).getByTestId('job-actions')
    expect(within(actions).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['More', 'Pause', 'Run now'])

    fireEvent.click(photos)
    expect(opened).toHaveBeenCalledWith('photos')
    opened.mockClear()
    fireEvent.click(within(actions).getByRole('button', { name: 'Run now' }))
    expect(opened).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledWith('photos')
  })

  it('says on Resume why a paused job is running, and leaves an idle paused job unexplained', async () => {
    page({ jobs: [job('photos', { disabled: true, running: true }), job('music', { disabled: true })] })
    const running = await within(await waitFor(() => row('photos'))).findByRole('button', { name: 'Resume' })
    fireEvent.focus(running)
    const tip = document.getElementById(running.getAttribute('aria-describedby') ?? '')
    expect(tip?.textContent).toContain(en['jobs.resumeRunningHint'])
    const idle = within(row('music')).getByRole('button', { name: 'Resume' })
    fireEvent.focus(idle)
    expect(idle.getAttribute('aria-describedby')).toBeNull()
  })

  it('names the job in a button the keyboard reaches first, which opens it once', async () => {
    page()
    await screen.findAllByRole('button', { name: 'Pause' })
    const name = within(row('photos')).getAllByRole('button')[0]!
    expect(name).toBe(screen.getByRole('button', { name: 'photos' }))
    fireEvent.click(name)
    expect(opened).toHaveBeenCalledOnce()
    expect(opened).toHaveBeenCalledWith('photos')
  })

  it('names a draft in a button that opens it in the editor', async () => {
    config.mockImplementation(() => Promise.resolve({ jobs: [...pair(), { name: 'draft', left: '', right: '' }] }))
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'draft' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('offers in More what the job page offers, without opening the job', async () => {
    page()
    await screen.findAllByRole('button', { name: 'Pause' })
    fireEvent.click(within(row('photos')).getByRole('button', { name: 'More' }))
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem')
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      'Edit', 'Duplicate', 'Preview', 'Check this job', 'Find duplicates', "Open this job's trash", 'Remove',
    ])
    expect(opened).not.toHaveBeenCalled()
  })

  it('edits a job from its card in a window on the jobs page', async () => {
    page()
    await screen.findAllByRole('button', { name: 'Pause' })
    fireEvent.click(within(row('photos')).getByRole('button', { name: 'More' }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Edit' }))
    expect(await screen.findByRole('dialog', { name: 'Edit photos' })).toBeTruthy()
    expect(opened).not.toHaveBeenCalled()
  })

  it('removes only that job from its card, after asking', async () => {
    page()
    await screen.findAllByRole('button', { name: 'Pause' })
    fireEvent.click(within(row('photos')).getByRole('button', { name: 'More' }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Remove' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete it' }))
    await waitFor(() => expect(saveConfig).toHaveBeenCalled())
    expect(saveConfig.mock.calls[0][0]).toEqual([pair()[1]])
  })

  it('opens the job page at its check card for Check this job', async () => {
    page()
    await screen.findAllByRole('button', { name: 'Pause' })
    fireEvent.click(within(row('photos')).getByRole('button', { name: 'More' }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Check this job' }))
    expect(window.location.pathname + window.location.search).toBe('/jobs/photos?card=check')
    window.history.replaceState(null, '', '/')
  })

  it("leads to the job's trash from its card", async () => {
    page()
    await screen.findAllByRole('button', { name: 'Pause' })
    fireEvent.click(within(row('photos')).getByRole('button', { name: 'More' }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: "Open this job's trash" }))
    expect(went).toHaveBeenLastCalledWith({ tab: 'trash', job: 'photos' })
  })

  it('shows the last runs as a strip under its status and keeps a run that worked quiet', async () => {
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
    expect(badge.className).toContain('glim-badge--warn')
    expect(status.querySelector('.bg-statusOkSolid')).toBeNull()
    fireEvent.click(badge)
    expect(went).toHaveBeenLastCalledWith({ tab: 'anomalies', job: 'music', finding: 'f1' })
    expect(opened).not.toHaveBeenCalled()
  })

  it('leads a held run to its job while the anomaly notes are off', async () => {
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
    expect(went).toHaveBeenLastCalledWith({ tab: 'jobs', job: 'music' })
    expect(screen.queryByRole('dialog')).toBeNull()
    followSettings({})
  })

  it('names a waiting conflict in the warn colour and leads to it, not to the job', async () => {
    page({ conflicts: [{ job: 'photos' }] })
    const status = within(row('photos')).getByTestId('job-status')
    expect(status.textContent).toBe('Conflict waiting')
    const badge = within(status).getByText('Conflict waiting')
    expect(badge.className).toContain('glim-badge--warn')
    expect(status.querySelector('.bg-statusOkSolid')).toBeNull()
    expect(within(row('music')).getByTestId('job-status').querySelector('.bg-statusOkSolid')).toBeTruthy()
    fireEvent.click(badge)
    expect(went).toHaveBeenLastCalledWith({ tab: 'conflicts', job: 'photos' })
    expect(opened).not.toHaveBeenCalled()
  })

  it('shows a run that left files for the next one as synced', async () => {
    page({ jobs: [job('photos', { recent: [{ ...ran('photos'), Skipped: 2 }] }), job('music')] })
    const status = within(row('photos')).getByTestId('job-status')
    expect(status.textContent).not.toBe('Needs a look')
    expect(status.querySelector('.bg-statusOkSolid')).toBeTruthy()
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
    const filled = screen.getAllByRole('button').filter((b) => b.className.split(' ').includes('glim-btn--accent'))
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
    fireEvent.click(within(screen.getByTestId('page-actions')).getByRole('button', { name: 'More' }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Run all' }))
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    expect(run).toHaveBeenCalledWith('photos')
  })
})

describe('the first job card', () => {
  it('gets the room its badge needs above it', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.css'), 'utf8')
    const rule = css.match(/([^{}]*\.glim-notch-card[^{}]*)\{\s*margin-top: 11px;/)
    expect(rule).toBeTruthy()
    const selectors = rule![1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim())
    page()
    const [first, second] = [...document.querySelectorAll('li > .glim-notch-card')] as HTMLElement[]
    expect(selectors.some((s) => first!.matches(s))).toBe(true)
    expect(selectors.some((s) => second!.matches(s))).toBe(false)
  })
})

describe('Run now on the Jobs page', () => {
  it('asks for the jobs again once the engine has taken the run', async () => {
    page()
    await screen.findByText('photos')
    saved.mockClear()
    fireEvent.click(screen.getAllByRole('button', { name: 'Run now' })[0])
    await waitFor(() => expect(run).toHaveBeenCalledWith('photos'))
    await waitFor(() => expect(saved).toHaveBeenCalled())
  })

  it('asks for the jobs again after Run all', async () => {
    page()
    await screen.findByText('photos')
    saved.mockClear()
    fireEvent.click(within(screen.getByTestId('page-actions')).getByRole('button', { name: 'More' }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Run all' }))
    await waitFor(() => expect(saved).toHaveBeenCalled())
  })
})
