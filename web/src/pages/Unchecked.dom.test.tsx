// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConflictListing, TrashSide } from '../lib/api'
import { ToastProvider } from '../lib/toast'

vi.mock('../lib/api', () => ({ ApiError: class extends Error {}, api: {} }))

const { Trash } = await import('./Trash')
const { Conflicts } = await import('./Conflicts')

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

afterEach(cleanup)

const side = (s: string, more: Partial<TrashSide> = {}): TrashSide => ({
  job: 'photos',
  side: s,
  store: 'trash',
  dir: '.arrowloop/trash',
  total: 0,
  bytes: 0,
  entries: [],
  mark: '',
  ...more,
})

const sides = [side('left'), side('right', { unchecked: true })]

describe('a side only its VPN reaches while that is off', () => {
  it('is not checked on the trash of every job, and a press checks it', () => {
    const onCheck = vi.fn()
    render(
      <ToastProvider>
        <Trash sides={sides} job="" onJob={() => undefined} onChanged={() => undefined} onCheck={onCheck} />
      </ToastProvider>,
    )
    expect(screen.getByText(/^Not checked/)).toBeTruthy()
    expect(onCheck).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(onCheck).toHaveBeenCalledWith('photos')
  })

  it("is checked once the job's own trash is opened", () => {
    const onCheck = vi.fn()
    render(
      <ToastProvider>
        <Trash sides={sides} job="photos" onJob={() => undefined} onChanged={() => undefined} onCheck={onCheck} />
      </ToastProvider>,
    )
    expect(onCheck).toHaveBeenCalledWith('photos')
  })

  it('leaves the conflicts of its job unchecked until asked', () => {
    const onCheck = vi.fn()
    const listing: ConflictListing = { conflicts: [], unread: [{ job: 'photos', error: '', unchecked: true }] }
    render(
      <ToastProvider>
        <Conflicts listing={listing} job="" onJob={() => undefined} onChanged={() => undefined} onCheck={onCheck} />
      </ToastProvider>,
    )
    expect(screen.getByText(/^Not checked/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(onCheck).toHaveBeenCalledWith('photos')
  })
})
