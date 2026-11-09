// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Finding } from '../lib/anomalies'
import type { Job, OtherInstance, RawJob, Run } from '../lib/api'
import type { NavCounts } from '../lib/navModel'
import { OpenJob } from '../lib/openJob'
import { ToastProvider } from '../lib/toast'

const config = vi.fn(() => Promise.resolve({ jobs: [] as RawJob[] }))
const run = vi.fn((name: string) => Promise.resolve({ job: name, status: 'started' }))
const instances = vi.fn(() => Promise.resolve([] as OtherInstance[]))
const versions = vi.fn(() =>
  Promise.resolve<{ arrowloop: string; rclone: string; go: string; deployment?: string; newRelease?: string }>({
    arrowloop: 'v2.6.3',
    rclone: 'v1.76.0',
    go: 'go1.27.1',
  }),
)

vi.mock('../lib/api', () => ({
  api: {
    config: () => config(),
    settings: () => Promise.resolve({}),
    volumes: () => Promise.resolve({ volumes: [] }),
    remotes: () => Promise.resolve({ remotes: [], backends: [] }),
    run: (name: string) => run(name),
    stopJob: () => Promise.resolve({ stopped: true }),
    instances: () => instances(),
    versions: () => versions(),
  },
}))

const { Overview } = await import('./Overview')

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

function ran(id: number, job: string, err = ''): Run {
  const at = new Date(Date.now() - id * 60_000).toISOString()
  return {
    ID: id, Job: job, Started: at, Finished: at, Copied: 3, Moved: 0, Trashed: 1, Conflicts: 0,
    DirsMade: 0, DirsRemoved: 0, Unchanged: 0, Skipped: 0, Err: err,
  }
}

function job(name: string, over: Partial<Job> = {}): Job {
  return {
    name,
    left: `D:/${name}`,
    right: `nas:${name}`,
    direction: 'both',
    schedule: '',
    watch: false,
    disabled: false,
    running: false,
    lastSuccess: null,
    recent: [ran(1, name)],
    ...over,
  }
}

const none: NavCounts = { running: 0, conflicts: 0, trash: 0, findings: 0 }
const opened = vi.fn((_name: string) => undefined)

function page({
  jobs = [job('photos'), job('music')],
  runs = [] as Run[],
  findings = [] as Finding[],
  counts = none,
  anomalies = true,
}: { jobs?: Job[]; runs?: Run[]; findings?: Finding[]; counts?: NavCounts; anomalies?: boolean } = {}) {
  render(
    <ToastProvider>
      <OpenJob.Provider value={opened}>
        <Overview
          jobs={jobs}
          runs={runs}
          findings={findings}
          counts={counts}
          anomalies={anomalies}
          progress={{}}
          onSaved={() => undefined}
        />
      </OpenJob.Provider>
    </ToastProvider>,
  )
}

const tile = (label: string) => screen.getByText(label, { selector: 'a span' }).closest('a') as HTMLAnchorElement

beforeEach(() => {
  config.mockReset()
  config.mockImplementation(() => Promise.resolve({ jobs: [] }))
  run.mockClear()
  instances.mockReset()
  instances.mockImplementation(() => Promise.resolve([]))
  opened.mockClear()
  versions.mockReset()
  versions.mockImplementation(() => Promise.resolve({ arrowloop: 'v2.6.3', rclone: 'v1.76.0', go: 'go1.27.1' }))
  localStorage.clear()
  window.history.replaceState(null, '', '/dashboard')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const found = (newRelease: string, deployment = 'container') =>
  versions.mockImplementation(() => Promise.resolve({ arrowloop: 'v2.6.3', rclone: 'v1.76.0', go: 'go1.27.1', deployment, newRelease }))

describe('a newer release on the overview', () => {
  it('tells a container which version is out and how to update it', async () => {
    found('v2.7.0')
    page()
    expect(await screen.findByText('ArrowLoop 2.7.0 is out')).toBeTruthy()
    expect(screen.getByText(/Update the container the way you deployed it/)).toBeTruthy()
  })

  it('opens the release notes of that version', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    found('v2.7.0')
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'Release notes' }))
    expect(open).toHaveBeenCalledWith('https://github.com/junkerderprovinz/arrowloop/releases/tag/v2.7.0', '_blank', 'noopener,noreferrer')
  })

  it('stays hidden in this browser once hidden, until the next release', async () => {
    found('v2.7.0')
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'Hide' }))
    expect(screen.queryByText('ArrowLoop 2.7.0 is out')).toBeNull()

    cleanup()
    page()
    await waitFor(() => expect(versions).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('ArrowLoop 2.7.0 is out')).toBeNull()

    cleanup()
    found('v2.8.0')
    page()
    expect(await screen.findByText('ArrowLoop 2.8.0 is out')).toBeTruthy()
  })

  it('stays away from the desktop app, which updates itself', async () => {
    found('v2.7.0', 'desktop')
    page()
    await waitFor(() => expect(versions).toHaveBeenCalled())
    expect(screen.queryByText(/is out/)).toBeNull()
  })
})

describe('the overview', () => {
  it('says all is well when nothing waits', () => {
    page()
    expect(screen.getByRole('heading', { level: 1, name: 'All is well' })).toBeTruthy()
  })

  it('counts what waits for the person in its headline, a failed run among it', () => {
    page({ jobs: [job('photos', { recent: [ran(1, 'photos', 'disk full')] }), job('music')], counts: { ...none, conflicts: 2 } })
    expect(screen.getByRole('heading', { level: 1, name: 'Waiting for you: 3' })).toBeTruthy()
  })

  it('counts each kind on a tile that leads to its page', () => {
    page({
      jobs: [job('photos', { running: true }), job('music', { disabled: true }), job('docs', { recent: [ran(1, 'docs', 'gone')] })],
      counts: { running: 1, conflicts: 4, trash: 7, findings: 2 },
    })
    const counted = (label: string) => [tile(label).querySelector('span')?.textContent, tile(label).getAttribute('href')]
    expect(counted('Running')).toEqual(['1', '/jobs'])
    expect(counted('Paused')).toEqual(['1', '/jobs'])
    expect(counted('Failed')).toEqual(['1', '/jobs'])
    expect(counted('Conflicts')).toEqual(['4', '/conflicts'])
    expect(counted('Anomalies')).toEqual(['2', '/anomalies'])
    expect(counted('Trash')).toEqual(['7', '/trash'])
  })

  it('leaves the Anomalies tile out while the notes are off', () => {
    page({ anomalies: false })
    expect(screen.queryByText('Anomalies', { selector: 'a span' })).toBeNull()
  })

  it('follows a tile to its page', () => {
    page({ counts: { ...none, conflicts: 1 } })
    fireEvent.click(tile('Conflicts'))
    expect(window.location.pathname).toBe('/conflicts')
  })

  it('lists the jobs in the order it is given, each leading to its page, with Run now', async () => {
    page({ jobs: [job('music'), job('photos')] })
    const jobs = screen.getByText('Jobs', { selector: 'h2 *' }).closest('.glim-panel') as HTMLElement
    const links = within(jobs).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/jobs/music', '/jobs/photos'])
    fireEvent.click(within(jobs).getAllByRole('button', { name: 'Run now' })[1]!)
    await waitFor(() => expect(run).toHaveBeenCalledWith('photos'))
    expect(opened).not.toHaveBeenCalled()
  })

  it('opens a job from a click on its line', () => {
    page()
    fireEvent.click(screen.getByText('music').closest('li')!)
    expect(opened).toHaveBeenCalledWith('music')
  })

  it('shows the latest runs with what they moved, and leads to the whole history', () => {
    page({ runs: [ran(1, 'photos'), ran(2, 'music', 'disk full')] })
    expect(screen.getByText('copied: 3 · trashed: 1', { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Every run' }))
    expect(window.location.pathname).toBe('/history')
  })

  it('says what to do when there is no job yet, and offers to add one', async () => {
    page({ jobs: [] })
    expect(screen.getByRole('heading', { level: 1, name: 'No jobs yet' })).toBeTruthy()
    expect(screen.getByText(/Add the first one/)).toBeTruthy()
    expect(screen.queryByText('In numbers')).toBeNull()
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Add a job' })[0]!.hasAttribute('disabled')).toBe(false))
  })

  it('lets the tiles fill the card, two to a row on a phone and all in one once there is room', () => {
    page()
    const tiles = screen.getByTestId('overview-tiles')
    expect(tiles.parentElement!.classList.contains('@container')).toBe(true)
    expect(tiles.classList.contains('flex-wrap')).toBe(true)
    for (const a of tiles.querySelectorAll('a')) {
      expect(a.classList.contains('grow')).toBe(true)
      expect(a.className).toContain('basis-[calc((100%-0.75rem)/2)]')
      expect(a.className).toContain('@lg:basis-[calc((100%-1.5rem)/3)]')
      expect(a.className).toContain('@4xl:basis-0')
    }
  })

  it('shows a paired instance with its jobs, when each ran and its latest runs', async () => {
    const backup = job('backup', { recent: [ran(3, 'backup', 'disk full')], nextRun: new Date(Date.now() + 3_600_000).toISOString() })
    const mail = job('mail', { recent: [ran(1, 'mail'), ran(5, 'mail')] })
    instances.mockImplementation(() =>
      Promise.resolve([{ id: 'n1', name: 'Attic NAS', deployment: 'server', state: 'ok', jobs: [backup, mail] } as OtherInstance]),
    )
    page()
    const card = (await screen.findByText('Attic NAS')).closest('.glim-panel') as HTMLElement
    expect(card.querySelector('li[data-job="backup"]')!.textContent).toMatch(/last run .*next run/)
    const runs = within(card).getByTestId('instance-runs')
    expect(within(runs).getByText('Last runs')).toBeTruthy()
    expect(within(runs).getAllByRole('listitem').map((li) => li.querySelector('.truncate')?.textContent)).toEqual(['mail', 'backup', 'mail'])
  })

  it('says when an instance that is away was last seen, without its jobs', async () => {
    const seen = Math.floor(Date.now() / 1000) - 600
    instances.mockImplementation(() =>
      Promise.resolve([{ id: 'n1', name: 'Attic NAS', deployment: 'server', state: 'away', lastSeen: seen } as OtherInstance]),
    )
    page()
    const card = (await screen.findByText('Attic NAS')).closest('.glim-panel') as HTMLElement
    expect(within(card).getByText(/Not reachable, last seen/)).toBeTruthy()
    expect(within(card).queryByTestId('instance-runs')).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Run now' })).toBeNull()
  })

  it('shows the paired instances only once there are any', async () => {
    instances.mockImplementation(() =>
      Promise.resolve([{ id: 'n1', name: 'Attic NAS', deployment: 'server', state: 'ok', jobs: [job('backup')] } as OtherInstance]),
    )
    page()
    expect(await screen.findByText('Attic NAS')).toBeTruthy()
    cleanup()
    instances.mockImplementation(() => Promise.resolve([]))
    page()
    await waitFor(() => expect(instances).toHaveBeenCalled())
    expect(screen.queryByText('Attic NAS')).toBeNull()
  })
})
