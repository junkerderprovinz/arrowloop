// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Plan, Resolution } from '../lib/api'

const plan: Plan = {
  actions: [
    { path: 'report.docx', kind: 'copy', from: 'left', to: 'right', reason: { code: 'changed' } as never },
    { path: 'old.txt', kind: 'delete', to: 'right', reason: { code: 'deleted' } as never },
  ],
  dirs: [],
  skipped: [],
  passedOver: [],
  unchanged: 0,
  agreed: 0,
}
const run = vi.fn((_job: string, _only?: string[], _resolve?: Record<string, Resolution>, _shown?: unknown) =>
  Promise.resolve({ job: 'docs', status: 'started' }),
)

vi.mock('../lib/api', () => ({
  api: {
    plan: () => Promise.resolve(plan),
    run: (job: string, only?: string[], resolve?: Record<string, Resolution>, shown?: unknown) =>
      run(job, only, resolve, shown),
  },
}))

const { Preview } = await import('./Preview')

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

afterEach(cleanup)

describe('the preview', () => {
  it('runs each ticked row as what it showed, not only by its path', async () => {
    render(<Preview job="docs" onDone={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: /Run 2 of 2/ }))

    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0][3]).toEqual({
      'report.docx': { kind: 'copy', from: 'left', to: 'right' },
      'old.txt': { kind: 'delete', to: 'right' },
    })
  })

  it('names a folder left out for good apart from the work left for later', async () => {
    plan.passedOver = [{ path: 'Personal Vault', reason: { code: 'sealed', vars: { side: 'left' } } as never }]
    try {
      render(<Preview job="docs" onDone={() => undefined} />)
      expect(await screen.findByRole('heading', { level: 3, name: 'Left out for good' })).toBeTruthy()
      expect(screen.getByText('Personal Vault')).toBeTruthy()
      expect(screen.queryByRole('heading', { level: 3, name: 'Left for later' })).toBeNull()
    } finally {
      plan.passedOver = []
    }
  })
})

describe('Escape on the preview', () => {
  function open() {
    const onDone = vi.fn()
    render(
      <>
        <button type="button">Elsewhere</button>
        <Preview job="docs" onDone={onDone} />
      </>,
    )
    return onDone
  }

  it('leaves the page alone while the focus is elsewhere on it', async () => {
    const onDone = open()
    await screen.findByRole('button', { name: /Run 2 of 2/ })
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
    elsewhere.focus()
    fireEvent.keyDown(elsewhere, { key: 'Escape' })
    expect(onDone).not.toHaveBeenCalled()
  })

  it('closes the preview from inside it', async () => {
    const onDone = open()
    const runButton = await screen.findByRole('button', { name: /Run 2 of 2/ })
    runButton.focus()
    fireEvent.keyDown(runButton, { key: 'Escape' })
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('only closes an info bubble that is open', async () => {
    const onDone = open()
    await screen.findByRole('button', { name: /Run 2 of 2/ })
    const back = screen.getByRole('button', { name: 'Back' })
    fireEvent.focus(back)
    expect(await screen.findByRole('tooltip')).toBeTruthy()
    fireEvent.keyDown(back, { key: 'Escape' })
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
