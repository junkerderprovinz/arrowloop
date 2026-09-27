// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Run } from '../lib/api'

const history = vi.fn((_job: unknown, _show: unknown, limit: number) =>
  Promise.resolve(Array.from({ length: Math.min(limit, 25) }, (_, i) => run(i + 1))),
)

vi.mock('../lib/api', () => ({
  api: {
    jobs: () => Promise.resolve([]),
    history: (...args: [unknown, unknown, number]) => history(...args),
    log: () => Promise.resolve([]),
    volumes: () => Promise.resolve({ volumes: [] }),
    watch: () => () => undefined,
  },
}))
vi.mock('../lib/desk', () => ({ desk: { paused: () => Promise.resolve(false) } }))

const { Activity } = await import('./Activity')

function run(id: number): Run {
  const at = '2027-03-01T12:00:00Z'
  return {
    ID: id, Job: `job ${id}`, Started: at, Finished: at, Copied: 1, Moved: 0, Trashed: 0, Conflicts: 0,
    DirsMade: 0, DirsRemoved: 0, Unchanged: 0, Skipped: 0, Err: '',
  } as Run
}

// jsdom has no ResizeObserver, which the view switch uses to measure its room.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

// jsdom has no layout either, so the test says when the end of the list comes
// into view.
let seen: (() => void) | null = null
beforeEach(() => {
  seen = null
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
      observe() {
        seen = () => this.cb([{ isIntersecting: true }])
      }
      disconnect() {
        seen = null
      }
    },
  )
  localStorage.clear()
  history.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the tray window', () => {
  it('asks for more runs when its list is scrolled to the end', async () => {
    render(<Activity />)
    await screen.findByText('job 10')
    expect(screen.queryByText('job 11')).toBeNull()

    act(() => seen?.())
    await screen.findByText('job 20')
    expect(history).toHaveBeenLastCalledWith(undefined, 'all', 20)

    act(() => seen?.())
    await screen.findByText('job 25')
    // All 25 are there, so the list stops asking.
    await waitFor(() => expect(seen).toBeNull())
  })
})
