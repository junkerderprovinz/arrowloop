// @vitest-environment jsdom
// The Trash, Anomalies and History pages, each held to the list rules it was
// built for.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Finding, FindingListing } from '../lib/anomalies'
import type { Run, TrashSide } from '../lib/api'
import type { JobLearning } from '../lib/anomalies'
import { ToastProvider } from '../lib/toast'

const pruneTrash = vi.fn((_job: string, _side: string, days: number, _mark: string) => Promise.resolve({ entries: days }))
const history = vi.fn(() => Promise.resolve([] as Run[]))

const learning = vi.fn(() => Promise.resolve([] as JobLearning[]))

vi.mock('../lib/api', () => ({
  api: {
    pruneTrash: (job: string, side: string, days: number, mark: string) => pruneTrash(job, side, days, mark),
    config: () => Promise.resolve({ jobs: [] }),
    settings: () => Promise.resolve({}),
    learning: () => learning(),
    history: () => history(),
    log: () => Promise.resolve([]),
    historyStats: () => Promise.reject(new Error('none')),
    runEntries: () => Promise.resolve([]),
  },
}))

const { Trash } = await import('./Trash')
const { Anomalies } = await import('./Anomalies')
const { History } = await import('./History')

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

const scrolled = vi.fn()
Element.prototype.scrollIntoView = function (this: Element) {
  scrolled(this.id)
}

afterEach(cleanup)

function wrap(node: ReactNode) {
  render(<ToastProvider>{node}</ToastProvider>)
}

describe('the trash', () => {
  const side: TrashSide = {
    job: 'docs', side: 'left', store: '', dir: '', total: 1, bytes: 10, mark: 'm',
    entries: [{ path: 'a.txt', runId: 'r1', remote: 'a.txt', size: 10, filed: '2027-03-01T03:00:00Z', modified: '' }],
  } as TrashSide

  it('asks the age in the window of the action that needs it', async () => {
    wrap(<Trash sides={[side]} job="" onJob={() => undefined} onChanged={() => undefined} />)
    expect(screen.queryByRole('spinbutton')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Delete old entries' }))
    const window = await screen.findByRole('dialog')
    fireEvent.change(within(window).getByRole('spinbutton'), { target: { value: '7' } })
    fireEvent.click(within(window).getByRole('button', { name: 'Delete old entries' }))
    await waitFor(() => expect(pruneTrash).toHaveBeenCalledWith('docs', 'left', 7, 'm'))
  })

  const music = {
    ...side,
    job: 'music',
    entries: [{ ...side.entries[0], path: 'song.mp3', remote: 'song.mp3' }],
  } as TrashSide

  it('follows the job the address names', () => {
    const { rerender } = render(
      <ToastProvider>
        <Trash sides={[side, music]} job="docs" onJob={() => undefined} onChanged={() => undefined} />
      </ToastProvider>,
    )
    expect(screen.queryByText('song.mp3')).toBeNull()
    rerender(
      <ToastProvider>
        <Trash sides={[side, music]} job="" onJob={() => undefined} onChanged={() => undefined} />
      </ToastProvider>,
    )
    expect(screen.getByText('song.mp3')).toBeTruthy()
  })

  it('makes emptying the trash the filled button in the corner', () => {
    wrap(<Trash sides={[side, music]} job="" onJob={() => undefined} onChanged={() => undefined} />)
    const empty = screen.getByRole('button', { name: 'Empty the trash' })
    expect(empty.closest('[data-testid="page-actions"]')).toBeTruthy()
    expect(empty.className.split(' ')).toContain('bg-accent')
  })

  it('puts its two actions side by side rather than one in a menu', () => {
    wrap(<Trash sides={[side, music]} job="" onJob={() => undefined} onChanged={() => undefined} />)
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
    const prune = screen.getByRole('button', { name: 'Delete old entries' })
    expect(prune.closest('[data-testid="page-actions"]')).toBeTruthy()
    expect(prune.className.split(' ')).not.toContain('bg-accent')
  })

  it('has no search, and names the job a link narrowed it to in a chip that undoes it', () => {
    const onJob = vi.fn()
    wrap(<Trash sides={[side, music]} job="docs" onJob={onJob} onChanged={() => undefined} />)
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
    expect(screen.getByText('Only docs')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show every job' }))
    expect(onJob).toHaveBeenCalledWith('')
  })
})

describe('the anomalies', () => {
  const finding = (id: string, severity: Finding['severity']): Finding => ({
    id, job: 'docs', kind: severity === 'critical' ? 'delete' : 'overdue', severity, held: severity === 'critical', since: '2027-03-01T03:00:00Z', seen: '', open: true,
  })
  const listing: FindingListing = { open: [finding('c', 'critical'), finding('w', 'warning')], closed: [] }

  function page(focus?: string) {
    wrap(<Anomalies listing={listing} job="" finding={focus} refused={{}} onJob={() => undefined} onChanged={() => undefined} />)
  }

  it('has tiles that pick a severity, keeping the rest of the page', () => {
    page()
    expect(document.querySelectorAll('[id^="finding-"]')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /^Warnings/ }))
    expect(screen.getByRole('button', { name: /^Warnings/ }).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelectorAll('[id^="finding-"]')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^Critical/ })).toBeTruthy()
  })

  it('shows each finding as a card with its answers, and opens no window', () => {
    page('c')
    const card = document.getElementById('finding-c') as HTMLElement
    expect(within(card).getByText('This run would delete 0 of 0 files (0 %, limit 0 %).')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Take back' })).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Run anyway' })).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Open job' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(scrolled).toHaveBeenCalledWith('finding-c')
  })

  it('keeps the files a brake counted folded until Show more, then names ten and counts the rest', () => {
    const paths = Array.from({ length: 12 }, (_, i) => `photos/${i}.jpg`)
    const held = { ...finding('c', 'critical'), count: 40, known: 50, paths }
    wrap(<Anomalies listing={{ open: [held], closed: [] }} job="" refused={{}} onJob={() => undefined} onChanged={() => undefined} />)
    expect(screen.queryByText('photos/0.jpg')).toBeNull()
    const more = screen.getByRole('button', { name: 'Show more' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(more)
    expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('photos/9.jpg')).toBeTruthy()
    expect(screen.queryByText('photos/10.jpg')).toBeNull()
    expect(screen.getByText('and 30 more')).toBeTruthy()
  })

  it('offers Show more only on a card with more to say', () => {
    wrap(<Anomalies listing={{ open: [finding('w', 'warning')], closed: [] }} job="" refused={{}} onJob={() => undefined} onChanged={() => undefined} />)
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('lists no jobs that have nothing open', () => {
    page()
    expect(screen.queryByText('Nothing open')).toBeNull()
  })
})

describe('what the engine learned', () => {
  it('words an unusual run by its figures and offers no run again', () => {
    const odd: Finding = {
      id: 'u', job: 'docs', kind: 'unusual', severity: 'warning', held: false, since: '2027-03-01T03:00:00Z', seen: '', open: true,
      figures: [{ figure: 'deleted', value: 412, low: 0, high: 6 }],
    }
    wrap(<Anomalies listing={{ open: [odd], closed: [] }} job="" refused={{}} onJob={() => undefined} onChanged={() => undefined} />)
    const card = document.getElementById('finding-u') as HTMLElement
    expect(within(card).getByText('Files deleted: 412, usually 0 to 6.')).toBeTruthy()
    expect(within(card).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Acknowledge', 'Open job'])
  })

  it('draws a ring per job that says how far it has learned', async () => {
    learning.mockImplementation(() =>
      Promise.resolve([
        { job: 'docs', runs: 4 },
        { job: 'photos', runs: 50, usual: [] },
      ]),
    )
    wrap(<Anomalies listing={{ open: [], closed: [] }} job="" refused={{}} onJob={() => undefined} onChanged={() => undefined} />)
    expect(await screen.findByRole('button', { name: 'docs · Runs learned from: 4 of 10' })).toBeTruthy()
    const photos = screen.getByRole('button', { name: 'photos · Learned' })
    expect(photos.querySelectorAll('circle.stroke-statusOkSolid')).toHaveLength(10)
    learning.mockImplementation(() => Promise.resolve([]))
  })
})

describe('the history', () => {
  const run = (err: string): Run => ({
    ID: err ? 2 : 1, Job: 'docs', Started: '2027-03-01T03:00:00Z', Finished: '2027-03-01T03:00:00Z',
    Copied: 1, Moved: 0, Trashed: 0, Conflicts: 0, DirsMade: 0, DirsRemoved: 0, Unchanged: 0, Skipped: 0, Err: err,
  })

  it('keeps a run that worked quiet and opens a run in a window', async () => {
    localStorage.setItem('arrowloop.history.view', JSON.stringify('runs'))
    history.mockImplementation(() => Promise.resolve([run(''), run('boom')]))
    wrap(<History runs={[]} jobs={[]} />)
    await screen.findAllByRole('button', { name: 'docs' })
    expect(screen.queryByText('Completed')).toBeNull()
    expect(screen.getAllByText('Failed')).toHaveLength(1)
    fireEvent.click(screen.getAllByRole('button', { name: 'docs' })[1])
    const window = await screen.findByRole('dialog')
    expect(within(window).getByText('boom')).toBeTruthy()
    localStorage.clear()
  })
})
