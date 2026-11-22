// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TrashSide } from '../lib/api'
import { ToastProvider } from '../lib/toast'

vi.mock('../lib/api', () => ({ ApiError: class extends Error {}, api: {} }))

const { Trash } = await import('./Trash')

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

function side(name: 'left' | 'right', paths: string[], bytes: number): TrashSide {
  return {
    job: 'docs',
    side: name,
    store: 'trash',
    dir: '.arrowloop/trash',
    total: paths.length,
    bytes,
    mark: '',
    entries: paths.map((path) => ({ path, runId: 'r1', remote: '', size: bytes / paths.length, filed: null, modified: '' })),
  }
}

afterEach(cleanup)

describe('the trash tiles', () => {
  it('give the size of a side that holds something', () => {
    render(
      <ToastProvider>
        <Trash sides={[side('left', ['a.txt', 'b.txt'], 2048), side('right', [], 0)]} job="" onJob={() => {}} onChanged={() => {}} onCheck={() => {}} />
      </ToastProvider>,
    )
    expect(screen.getAllByText('2 in the trash, 2.0 KB').length).toBeGreaterThan(0)
  })

  it('leave the size off a side whose trash is empty', () => {
    render(
      <ToastProvider>
        <Trash sides={[side('left', ['a.txt', 'b.txt'], 2048), side('right', [], 0)]} job="" onJob={() => {}} onChanged={() => {}} onCheck={() => {}} />
      </ToastProvider>,
    )
    expect(screen.queryByText(/0 B/)).toBeNull()
  })
})
