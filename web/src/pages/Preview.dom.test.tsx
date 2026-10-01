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
})
