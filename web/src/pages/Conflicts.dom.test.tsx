// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConflictListing, OpenConflict } from '../lib/api'
import { ToastProvider } from '../lib/toast'

const decide = vi.fn((_job: string, decisions: unknown[]) => Promise.resolve({ run: { Skipped: 0 }, decisions }))

vi.mock('../lib/api', () => ({
  ApiError: class extends Error {},
  api: { decide: (job: string, decisions: unknown[]) => decide(job, decisions) },
}))

const { Conflicts } = await import('./Conflicts')

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

function conflict(plain: string, job = 'docs'): OpenConflict {
  const side = { path: plain, size: 10, mod: '2027-03-01T03:00:00Z' }
  return { job, copy: `${plain}.conflict`, plain, side: 'left', at: '2027-03-01T03:00:00Z', left: side, right: side }
}

const listing: ConflictListing = { conflicts: ['a.txt', 'b.txt', 'c.txt', 'd.txt'].map((p) => conflict(p)), unread: [] }

function page() {
  render(
    <ToastProvider>
      <Conflicts listing={listing} job="" onJob={() => undefined} onChanged={() => undefined} />
    </ToastProvider>,
  )
}

const card = (name: string) => screen.getByText(name, { selector: 'span' }).closest('li') as HTMLElement

afterEach(() => {
  cleanup()
  decide.mockClear()
})

describe('the conflicts list', () => {
  it('follows the job the address names', () => {
    const both: ConflictListing = { conflicts: [conflict('a.txt'), conflict('song.mp3', 'music')], unread: [] }
    const at = (job: string) => (
      <ToastProvider>
        <Conflicts listing={both} job={job} onJob={() => undefined} onChanged={() => undefined} />
      </ToastProvider>
    )
    const { rerender } = render(at('docs'))
    expect(screen.queryAllByText('song.mp3')).toHaveLength(0)
    rerender(at(''))
    expect(screen.queryAllByText('song.mp3').length).toBeGreaterThan(0)
  })

  it('says what went wrong and answers in words that say what each answer does', () => {
    const changed = { ...conflict('a.txt'), why: 'changedBoth' }
    render(
      <ToastProvider>
        <Conflicts listing={{ conflicts: [changed], unread: [] }} job="" onJob={() => undefined} onChanged={() => undefined} />
      </ToastProvider>,
    )
    const a = card('a.txt')
    expect(within(a).getByText(/Both sides changed this file since the last sync/)).toBeTruthy()
    expect(within(a).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual([
      'Keep both files',
      'Keep the left version, trash the right',
      'Keep the right version, trash the left',
    ])
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('marks the side that holds the newer version and names the set-aside copy', () => {
    const newer = {
      ...conflict('a.txt'),
      left: { path: 'a.conflict-left-20270301-030000.txt', size: 10, mod: '2027-03-01T03:00:00Z' },
      right: { path: 'a.txt', size: 12, mod: '2027-03-02T03:00:00Z' },
    }
    render(
      <ToastProvider>
        <Conflicts listing={{ conflicts: [newer], unread: [] }} job="" onJob={() => undefined} onChanged={() => undefined} />
      </ToastProvider>,
    )
    expect(screen.getByText('a.conflict-left-20270301-030000.txt')).toBeTruthy()
    const right = screen.getByText('Right side').parentElement?.parentElement as HTMLElement
    expect(within(right).getByText('newer')).toBeTruthy()
    const left = screen.getByText('Left side').parentElement?.parentElement as HTMLElement
    expect(within(left).queryByText('newer')).toBeNull()
  })

  it('gives every conflict shown one answer from the corner, once asked', async () => {
    page()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Keep left for all' }))
    const ask = await screen.findByRole('dialog', { name: 'Keep left for all' })
    expect(ask.textContent).toContain('Conflicts: 4')
    expect(decide).not.toHaveBeenCalled()
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep left for all' }))
    await waitFor(() => expect(decide).toHaveBeenCalled())
    expect(decide.mock.calls[0][1]).toHaveLength(4)
  })

  it('offers no answer for all while one conflict waits', () => {
    render(
      <ToastProvider>
        <Conflicts listing={{ conflicts: [conflict('a.txt')], unread: [] }} job="" onJob={() => undefined} onChanged={() => undefined} />
      </ToastProvider>,
    )
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  })

  it('answers one conflict from its own card without opening anything', async () => {
    page()
    fireEvent.click(within(card('b.txt')).getByRole('button', { name: 'Keep the left version, trash the right' }))
    await waitFor(() => expect(decide).toHaveBeenCalled())
    expect(decide.mock.calls[0][1]).toEqual([{ copy: 'b.txt.conflict', keep: 'left' }])
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
