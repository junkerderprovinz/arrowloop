// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Job, LatestRun, Run, RunEvent, WindowSettings } from './lib/api'
import { ToastProvider } from './lib/toast'

let emit: (ev: RunEvent) => void = () => undefined

const jobs = vi.fn(() => Promise.resolve([] as Job[]))
const history = vi.fn(() => Promise.resolve([] as Run[]))
const latestRuns = vi.fn((_since: string) => Promise.resolve([] as LatestRun[]))
const desktop = vi.fn(() => false)
const settled: WindowSettings = {
  tray: false,
  closeToTray: false,
  minimiseToTray: false,
  startWithSystem: false,
  canStartWithSystem: false,
  autoUpdate: false,
}
const saveWindow = vi.fn((_next: WindowSettings) => Promise.resolve(settled))

vi.mock('./lib/api', async (actual) => ({
  ...(await actual<typeof import('./lib/api')>()),
  api: {
    jobs: () => jobs(),
    history: () => history(),
    latestRuns: (since: string) => latestRuns(since),
    volumes: () => Promise.resolve({ volumes: [] }),
    capabilities: () => Promise.resolve({ window: desktop(), version: 'test' }),
    window: () => Promise.resolve(settled),
    saveWindow: (next: WindowSettings) => saveWindow(next),
    session: () => Promise.resolve({ required: false, authenticated: false }),
    conflicts: () => Promise.resolve({ conflicts: [], unread: [] }),
    trashAll: () => Promise.resolve({ sides: [] }),
    config: () => Promise.resolve({ jobs: [] }),
    settings: () => Promise.resolve({}),
    remotes: () => Promise.resolve({ remotes: [], backends: [], providers: [], unlisted: [] }),
    watch: (on: (ev: RunEvent) => void) => {
      emit = on
      return () => undefined
    },
  },
}))

const { App } = await import('./App')

// jsdom has neither media queries nor element measuring.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
})) as unknown as typeof window.matchMedia
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

beforeEach(() => {
  jobs.mockReset()
  jobs.mockImplementation(() => Promise.resolve([]))
  history.mockReset()
  history.mockImplementation(() => Promise.resolve([]))
  latestRuns.mockReset()
  latestRuns.mockImplementation(() => Promise.resolve([]))
  desktop.mockReset()
  desktop.mockImplementation(() => false)
})
afterEach(cleanup)

function run(id: number, job: string, err = ''): Run {
  const at = new Date(Date.UTC(2027, 2, 1, 3, 0, id)).toISOString()
  return {
    ID: id, Job: job, Started: at, Finished: at, Copied: 0, Moved: 0, Trashed: 0, Conflicts: 0,
    DirsMade: 0, DirsRemoved: 0, Unchanged: 0, Skipped: 0, Err: err,
  }
}

function show() {
  render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  )
}

describe('the app', () => {
  it('drops the unreachable banner once the engine answers again', async () => {
    jobs.mockImplementationOnce(() => Promise.reject(new Error('Failed to fetch')))
    show()
    await screen.findByText('Cannot reach the engine')

    act(() => emit({ job: 'photos', phase: 'finished' }))
    await waitFor(() => expect(screen.queryByText('Cannot reach the engine')).toBeNull())
  })

  it('puts a window switch back and says why when saving it fails', async () => {
    desktop.mockImplementation(() => true)
    saveWindow.mockImplementationOnce(() => Promise.reject(new Error('could not set the autostart entry')))
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const tray = await screen.findByRole('switch', { name: 'Icon in the notification area' })
    fireEvent.click(tray)

    expect(await screen.findByText('could not set the autostart entry')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Icon in the notification area' }).getAttribute('aria-checked')).toBe('false')
  })

  it("marks a job failed after other jobs' runs fill the recent list", async () => {
    const nightly = { name: 'nightly', left: 'D:/Docs', right: 'nas:docs', direction: 'both', schedule: '0 3 * * *', watch: false, disabled: false, running: false, lastSuccess: null } as Job
    const watcher = { ...nightly, name: 'watcher', schedule: '', watch: true }
    jobs.mockImplementation(() => Promise.resolve([nightly, watcher]))
    history.mockImplementation(() => Promise.resolve(Array.from({ length: 50 }, (_, i) => run(100 - i, 'watcher'))))
    latestRuns.mockImplementation(() =>
      Promise.resolve([{ ...run(100, 'watcher'), Since: 50 }, { ...run(1, 'nightly', 'the right side is not there'), Since: 1 }]),
    )
    show()
    expect(await screen.findByRole('img', { name: 'last run failed' })).toBeTruthy()
    expect(screen.getAllByRole('img', { name: 'ready' })).toHaveLength(1)
  })
})
