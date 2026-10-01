// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Job, RunEvent } from './lib/api'

let emit: (ev: RunEvent) => void = () => undefined

const jobs = vi.fn(() => Promise.resolve([] as Job[]))

vi.mock('./lib/api', async (actual) => ({
  ...(await actual<typeof import('./lib/api')>()),
  api: {
    jobs: () => jobs(),
    history: () => Promise.resolve([]),
    latestRuns: () => Promise.resolve([]),
    volumes: () => Promise.resolve({ volumes: [] }),
    capabilities: () => Promise.resolve({ window: false, version: 'test' }),
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
})
afterEach(cleanup)

describe('the app', () => {
  it('drops the unreachable banner once the engine answers again', async () => {
    jobs.mockImplementationOnce(() => Promise.reject(new Error('Failed to fetch')))
    render(<App />)
    await screen.findByText('Cannot reach the engine')

    act(() => emit({ job: 'photos', phase: 'finished' }))
    await waitFor(() => expect(screen.queryByText('Cannot reach the engine')).toBeNull())
  })
})
