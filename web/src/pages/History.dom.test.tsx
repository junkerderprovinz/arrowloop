// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Run } from '../lib/api'

const at = '2027-03-01T03:00:00Z'
const run: Run = {
  ID: 7, Job: 'photos', Started: at, Finished: '2027-03-01T03:02:00Z', Copied: 3, Moved: 1, Trashed: 2, Conflicts: 5,
  DirsMade: 0, DirsRemoved: 0, Unchanged: 0, Skipped: 4, Err: '', Bytes: 2.2 * 1024 ** 3,
}

vi.mock('../lib/api', async (actual) => ({
  ...(await actual<typeof import('../lib/api')>()),
  api: {
    history: () => Promise.resolve([run]),
    historyStats: () => Promise.reject(new Error('none')),
    log: () => Promise.resolve([]),
  },
}))

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver
globalThis.IntersectionObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof IntersectionObserver

const { History } = await import('./History')

afterEach(cleanup)

describe('the runs in History', () => {
  it('have a column for each figure of a run, the bytes it sent among them', async () => {
    render(<History runs={[run]} jobs={[]} closed={null} onFindingChanged={() => {}} />)
    const row = (await screen.findByRole('button', { name: 'photos' })).closest('li') as HTMLElement
    for (const head of ['Copied', 'Moved', 'Removed', 'Left for later', 'Conflicts', 'Transferred']) {
      expect(screen.getAllByText(head).length, head).toBeGreaterThan(0)
    }
    const cells = [...row.querySelectorAll('[data-col]')].map((c) => [c.getAttribute('data-col'), c.textContent])
    expect(cells).toEqual([
      ['copied', '3'],
      ['moved', '1'],
      ['removed', '2'],
      ['left', '4'],
      ['conflicts', '5'],
      ['bytes', '2.2 GB'],
    ])
  })

  it('scroll sideways inside their card when the columns need more room than it has', async () => {
    render(<History runs={[run]} jobs={[]} closed={null} onFindingChanged={() => {}} />)
    const row = (await screen.findByRole('button', { name: 'photos' })).closest('li') as HTMLElement
    const scroller = row.closest('.overflow-x-auto') as HTMLElement
    expect(scroller).not.toBeNull()
    expect(scroller.contains(screen.getAllByText('Transferred')[0])).toBe(true)
    expect(scroller.closest('[data-glim="Card"]')).not.toBeNull()
    expect((scroller.parentElement as HTMLElement).style.getPropertyValue('--list-min')).toMatch(/^\d+px$/)
  })
})
