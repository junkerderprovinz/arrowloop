// @vitest-environment jsdom
// The Trash, Anomalies and History pages, each held to the list rules it was
// built for.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Finding, FindingListing } from '../lib/anomalies'
import type { Run, TrashSide } from '../lib/api'
import { ToastProvider } from '../lib/toast'

const pruneTrash = vi.fn((_job: string, _side: string, days: number, _mark: string) => Promise.resolve({ entries: days }))
const history = vi.fn(() => Promise.resolve([] as Run[]))

vi.mock('../lib/api', () => ({
  api: {
    pruneTrash: (job: string, side: string, days: number, mark: string) => pruneTrash(job, side, days, mark),
    config: () => Promise.resolve({ jobs: [] }),
    settings: () => Promise.resolve({}),
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
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Empty out the old ones' }))
    const window = await screen.findByRole('dialog')
    fireEvent.change(within(window).getByRole('spinbutton'), { target: { value: '7' } })
    fireEvent.click(within(window).getByRole('button', { name: 'Empty out the old ones' }))
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

  it('keeps every way to empty the trash shut while a search hides part of it', async () => {
    wrap(<Trash sides={[side, music]} job="" onJob={() => undefined} onChanged={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'song' } })
    expect((screen.getByRole('button', { name: 'Empty the trash' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const menu = await screen.findByRole('menu')
    expect((within(menu).getByRole('menuitem', { name: 'Empty out the old ones' }) as HTMLButtonElement).disabled).toBe(true)
    for (const empty of screen.getAllByRole('button', { name: 'Empty this side' })) {
      expect((empty as HTMLButtonElement).disabled).toBe(true)
    }
  })
})

describe('the anomalies', () => {
  const finding = (id: string, severity: Finding['severity']): Finding => ({
    id, job: 'docs', kind: severity === 'critical' ? 'delete' : 'overdue', severity, held: severity === 'critical', since: '2027-03-01T03:00:00Z', seen: '', open: true,
  })
  const listing: FindingListing = { open: [finding('c', 'critical'), finding('w', 'warning')], closed: [] }

  function page(focus?: string) {
    wrap(<Anomalies listing={listing} jobs={[]} job="" finding={focus} refused={{}} onChanged={() => undefined} />)
  }

  it('has tiles that pick a severity, keeping the rest of the page', () => {
    page()
    expect(screen.getAllByRole('listitem').filter((li) => li.textContent?.includes('docs'))).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /^Warnings/ }))
    expect(screen.getByRole('button', { name: /^Warnings/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByRole('listitem').filter((li) => li.textContent?.includes('docs'))).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^Critical/ })).toBeTruthy()
  })

  it('opens a finding in a window, the one another page sent somebody to', async () => {
    page('c')
    const window = await screen.findByRole('dialog', { name: 'docs: Mass deletion' })
    expect(within(window).getByRole('button', { name: 'Take back' })).toBeTruthy()
    expect(document.querySelector('[aria-expanded]:not([aria-haspopup])')).toBeNull()
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
