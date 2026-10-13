// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Job, Run, RunEvent, TrashSide, WindowSettings } from './lib/api'
import { ToastProvider } from './lib/toast'

let emit: (ev: RunEvent) => void = () => undefined

const jobs = vi.fn(() => Promise.resolve([] as Job[]))
const history = vi.fn(() => Promise.resolve([] as Run[]))
const desktop = vi.fn(() => false)
const settled: WindowSettings = {
  tray: false,
  closeToTray: false,
  minimiseToTray: false,
  startWithSystem: false,
  canStartWithSystem: false,
  autoUpdate: false,
}
const session = vi.fn(() => Promise.resolve({ required: false, authenticated: false }))
const saveWindow = vi.fn((_next: WindowSettings) => Promise.resolve(settled))
const trashAll = vi.fn(() => Promise.resolve({ sides: [] as TrashSide[] }))
const anomalies = vi.fn(() => Promise.resolve({ open: [], closed: [] }))
const settings = vi.fn(() => Promise.resolve({}))

vi.mock('./lib/api', async (actual) => ({
  ...(await actual<typeof import('./lib/api')>()),
  api: {
    jobs: () => jobs(),
    history: () => history(),
    volumes: () => Promise.resolve({ volumes: [] }),
    capabilities: () => Promise.resolve({ window: desktop(), version: 'test' }),
    window: () => Promise.resolve(settled),
    saveWindow: (next: WindowSettings) => saveWindow(next),
    session: () => session(),
    passkeys: () => Promise.resolve({ supported: false, rpId: '', total: 0, here: 0 }),
    conflicts: () => Promise.resolve({ conflicts: [], unread: [] }),
    anomalies: () => anomalies(),
    learning: () => Promise.resolve([]),
    trashAll: () => trashAll(),
    volumeCandidates: () => Promise.resolve({ candidates: [] }),
    config: () => Promise.resolve({ jobs: [] }),
    settings: () => settings(),
    remotes: () => Promise.resolve({ remotes: [], backends: [], providers: [], unlisted: [] }),
    watch: (on: (ev: RunEvent) => void) => {
      emit = on
      return () => undefined
    },
  },
}))

const { App, Gate } = await import('./App')
const real = await vi.importActual<typeof import('./lib/api')>('./lib/api')

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
  window.history.replaceState(null, '', '/')
  localStorage.clear()
  jobs.mockReset()
  jobs.mockImplementation(() => Promise.resolve([]))
  history.mockReset()
  history.mockImplementation(() => Promise.resolve([]))
  session.mockReset()
  session.mockImplementation(() => Promise.resolve({ required: false, authenticated: false }))
  desktop.mockReset()
  desktop.mockImplementation(() => false)
  trashAll.mockReset()
  trashAll.mockImplementation(() => Promise.resolve({ sides: [] }))
  anomalies.mockReset()
  anomalies.mockImplementation(() => Promise.resolve({ open: [], closed: [] }))
  settings.mockReset()
  settings.mockImplementation(() => Promise.resolve({}))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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
    fireEvent.click(await screen.findByRole('link', { name: 'Settings' }))
    const tray = await screen.findByRole('switch', { name: 'Icon in the notification area' })
    fireEvent.click(tray)

    expect(await screen.findByText('could not set the autostart entry')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Icon in the notification area' }).getAttribute('aria-checked')).toBe('false')
  })

  it('opens a new install on the welcome page and counts nothing in the rail', async () => {
    trashAll.mockImplementation(() => Promise.resolve({ sides: [{ job: 'old', side: 'left', total: 2, bytes: 10 } as TrashSide] }))
    show()
    await waitFor(() => expect(window.location.pathname).toBe('/welcome'))
    expect(await screen.findByRole('heading', { name: 'Welcome to ArrowLoop' })).toBeTruthy()
    expect(document.querySelector('.glim-nav-count')).toBeNull()
  })

  it('gives every page an address, and Back returns to the one before', async () => {
    jobs.mockImplementation(() => Promise.resolve([{ name: 'photos', left: 'a', right: 'b', direction: 'both', recent: [] as Run[] } as Job]))
    show()
    await waitFor(() => expect(window.location.pathname).toBe('/jobs'))
    fireEvent.click(screen.getByRole('link', { name: 'Conflicts' }))
    await waitFor(() => expect(window.location.pathname).toBe('/conflicts'))
    act(() => {
      window.history.back()
    })
    await waitFor(() => expect(window.location.pathname).toBe('/jobs'))
  })

  it('opens a page that is not in the sidebar on its settings tile', async () => {
    window.history.replaceState(null, '', '/targets')
    show()
    await waitFor(() => expect(window.location.pathname).toBe('/settings/targets'))
    expect(await screen.findByRole('switch', { name: 'Also show in the sidebar' })).toBeTruthy()
  })

  it("marks a job failed by its own last run after other jobs' runs fill the recent list", async () => {
    const nightly = {
      name: 'nightly', left: 'D:/Docs', right: 'nas:docs', direction: 'both', schedule: '0 3 * * *',
      watch: false, disabled: false, running: false, lastSuccess: null, recent: [run(1, 'nightly', 'the right side is not there')],
    } as Job
    const watcher = { ...nightly, name: 'watcher', schedule: '', watch: true, recent: [run(100, 'watcher')] }
    jobs.mockImplementation(() => Promise.resolve([nightly, watcher]))
    history.mockImplementation(() => Promise.resolve(Array.from({ length: 50 }, (_, i) => run(100 - i, 'watcher'))))
    show()
    expect(await screen.findByText('Failed')).toBeTruthy()
    expect(screen.getAllByTestId('job-row')).toHaveLength(2)
  })

  it('goes back to the login once the session has ended', async () => {
    session.mockImplementation(() => Promise.resolve({ required: true, authenticated: true }))
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ error: 'this interface is password protected, log in first' }), { status: 401 })),
    )
    jobs.mockImplementation(() => real.api.jobs())
    render(<Gate />)

    expect(await screen.findByText('This interface is protected')).toBeTruthy()
  })
})

describe('the findings', () => {
  const photos = {
    name: 'photos', left: 'D:/Photos', right: 'nas:photos', direction: 'both', schedule: '',
    watch: false, disabled: false, running: false, lastSuccess: null, recent: [],
  } as unknown as Job

  // An engine that reports a change on every read must not keep the page asking.
  for (const path of ['/settings/targets', '/anomalies']) {
    for (const off of [false, true]) {
      it(`are asked for a few times at most on ${path} with the notes ${off ? 'off' : 'on'}`, async () => {
        jobs.mockImplementation(() => Promise.resolve([photos]))
        settings.mockImplementation(() => Promise.resolve({ anomalies: { off } }))
        anomalies.mockImplementation(() => {
          setTimeout(() => emit({ job: 'photos', phase: 'anomaly' }), 0)
          return Promise.resolve({ open: [], closed: [] })
        })
        window.history.replaceState(null, '', path)
        show()
        await act(() => new Promise((done) => setTimeout(done, 1500)))
        expect(anomalies.mock.calls.length).toBeGreaterThanOrEqual(1)
        expect(anomalies.mock.calls.length).toBeLessThanOrEqual(3)
      })
    }
  }
})
