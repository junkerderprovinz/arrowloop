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

const row = (name: string) => screen.getByText(name).closest('li') as HTMLElement

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
    expect(screen.queryByText('song.mp3')).toBeNull()
    rerender(at(''))
    expect(screen.getByText('song.mp3')).toBeTruthy()
  })

  it('carries no selection marks, only the answers of each row', () => {
    page()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(within(row('a.txt')).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Keep both', 'Keep left', 'Keep right'])
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

  it('opens one conflict with its two versions on a plain click', async () => {
    page()
    fireEvent.click(row('b.txt'))
    const window = await screen.findByRole('dialog', { name: 'b.txt' })
    expect(within(window).getByRole('button', { name: 'Keep both' })).toBeTruthy()
  })

  it('answers one row from the menu a right-click opens', async () => {
    page()
    fireEvent.contextMenu(row('b.txt'))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Keep left' }))
    await waitFor(() => expect(decide).toHaveBeenCalled())
    expect(decide.mock.calls[0][1]).toEqual([{ copy: 'b.txt.conflict', keep: 'left' }])
  })
})
