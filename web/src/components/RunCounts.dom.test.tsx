// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Run, RunEntry } from '../lib/api'

vi.mock('../lib/api', () => ({
  api: { runEntries: () => Promise.resolve([] as RunEntry[]) },
}))

const { RecentRun } = await import('./RecentRun')
const { RunSheet } = await import('./RunSheet')

afterEach(cleanup)

const at = new Date().toISOString()
const run = (over: Partial<Run>): Run => ({
  ID: 7, Job: 'photos', Started: at, Finished: at, Copied: 0, Moved: 0, Trashed: 2, Conflicts: 0,
  DirsMade: 0, DirsRemoved: 0, Unchanged: 5, Skipped: 0, Err: '', ...over,
})

describe('the files a run removed', () => {
  it('went to the trash on a job that keeps one', () => {
    render(<RecentRun run={run({})} />)
    expect(screen.getByText('trashed: 2')).toBeTruthy()
  })

  it('are deleted on a job without a trash', () => {
    render(<RecentRun run={run({ NoTrash: true })} />)
    expect(screen.getByText('deleted: 2')).toBeTruthy()
    expect(screen.queryByText(/trash/)).toBeNull()
  })

  it('are counted as deleted in the run window of a job without a trash', () => {
    render(<RunSheet run={run({ NoTrash: true })} onClose={() => undefined} />)
    expect(screen.getByText('Deleted')).toBeTruthy()
    expect(screen.queryByText('To the trash')).toBeNull()
  })
})
