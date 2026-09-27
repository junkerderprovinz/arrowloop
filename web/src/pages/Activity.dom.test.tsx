// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Job, LatestRun, Touch } from '../lib/api'

const at = '2027-03-01T12:00:00Z'

function run(id: number, job: string, since: number): LatestRun {
  return {
    ID: id, Job: job, Started: at, Finished: at, Copied: 1, Moved: 0, Trashed: 0, Conflicts: 0,
    DirsMade: 0, DirsRemoved: 0, Unchanged: 0, Skipped: 0, Err: '', Since: since,
  }
}

function job(name: string): Job {
  return { name, left: 'D:\\Fotos', right: 'OpenCloud:bilder', running: false } as Job
}

function touch(n: number): Touch {
  return { Kind: 'copy', Side: 'right', Path: `file ${n}.jpg`, Note: '', Size: 0, Run: 1, Job: 'watcher', When: at, Seq: n }
}

const latest = vi.fn((_since: string) =>
  Promise.resolve([run(2, 'watcher', 37), run(1, 'daily', 1), run(3, 'gone', 4)]),
)
const log = vi.fn((_job: string, _kinds: string[], _q: string, limit: number) =>
  Promise.resolve(Array.from({ length: Math.min(limit, 25) }, (_, i) => touch(i + 1))),
)

vi.mock('../lib/api', () => ({
  api: {
    jobs: () => Promise.resolve([job('watcher'), job('daily')]),
    latestRuns: (since: string) => latest(since),
    log: (...args: [string, string[], string, number]) => log(...args),
    volumes: () => Promise.resolve({ volumes: [] }),
    watch: () => () => undefined,
  },
}))
vi.mock('../lib/desk', () => ({
  desk: { paused: () => Promise.resolve(false) },
  inDesktopWindow: () => false,
  resizeFromEdges: () => () => undefined,
}))

const { Activity } = await import('./Activity')

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
  latest.mockClear()
  log.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the tray window', () => {
  it('keeps a daily job beside one that runs all day', async () => {
    render(<Activity />)
    await screen.findByText('daily')
    expect(screen.getByText('watcher')).toBeTruthy()
    expect(screen.getByText(/37 runs today/)).toBeTruthy()
    // A job no longer configured keeps its runs in the history only.
    expect(screen.queryByText('gone')).toBeNull()
  })

  it('asks for more file changes when that list is scrolled to the end', async () => {
    localStorage.setItem('arrowloop.trayView', 'files')
    render(<Activity />)
    await screen.findAllByText('file 20.jpg', { exact: false })
    expect(screen.queryAllByText('file 21.jpg', { exact: false })).toHaveLength(0)

    act(() => seen?.())
    await screen.findAllByText('file 25.jpg', { exact: false })
    expect(log).toHaveBeenLastCalledWith('', [], '', 40)
    // All 25 are there, so the list stops asking.
    await waitFor(() => expect(seen).toBeNull())
  })
})
