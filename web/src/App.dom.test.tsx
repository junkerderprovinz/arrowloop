// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Job, RunEvent, WindowSettings } from './lib/api'
import { ToastProvider } from './lib/toast'

let emit: (ev: RunEvent) => void = () => undefined

const jobs = vi.fn(() => Promise.resolve([] as Job[]))
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
    history: () => Promise.resolve([]),
    latestRuns: () => Promise.resolve([]),
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
  desktop.mockReset()
  desktop.mockImplementation(() => false)
})
afterEach(cleanup)

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
})
