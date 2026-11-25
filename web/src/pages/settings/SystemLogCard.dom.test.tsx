// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SystemLine } from '../../lib/api'

let lines: SystemLine[] = []
const systemLog = vi.fn(() => Promise.resolve(lines))

vi.mock('../../lib/api', async (actual) => ({
  ...(await actual<typeof import('../../lib/api')>()),
  api: { systemLog: () => systemLog() },
}))

const { SystemLogCard } = await import('./SystemLogCard')

afterEach(() => {
  cleanup()
  systemLog.mockClear()
})

describe('the system log', () => {
  it('lists each error with its source and words, newest first', async () => {
    lines = [
      { ID: 3, At: '2027-03-01T12:02:00Z', Source: 'connection', Text: 'nas: no such host', Count: 4 },
      { ID: 2, At: '2027-03-01T12:01:00Z', Source: 'integration', Text: 'fortress: could not join the fortress', Count: 1 },
      { ID: 1, At: '2027-03-01T12:00:00Z', Source: 'rclone', Text: 'photos/a.jpg: Failed to copy: disk full', Count: 1 },
    ]
    render(<SystemLogCard hueIndex={0} />)

    const rows = await screen.findAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('nas: no such host'),
      expect.stringContaining('fortress: could not join the fortress'),
      expect.stringContaining('photos/a.jpg: Failed to copy: disk full'),
    ])
    expect(within(rows[0]!).getByText('Connection')).toBeTruthy()
    expect(within(rows[0]!).getByText('4×')).toBeTruthy()
    expect(within(rows[1]!).getByText('Integration')).toBeTruthy()
    expect(within(rows[1]!).queryByText(/×$/)).toBeNull()
    expect(within(rows[2]!).getByText('rclone')).toBeTruthy()
  })

  it('says so when nothing has gone wrong', async () => {
    lines = []
    render(<SystemLogCard hueIndex={0} />)
    expect(await screen.findByText('No errors so far.')).toBeTruthy()
    expect(screen.queryByRole('listitem')).toBeNull()
  })
})
