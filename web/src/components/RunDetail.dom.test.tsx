// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Job, RunEntry } from '../lib/api'
import { Places } from '../lib/places'

const entries = vi.fn(() => Promise.resolve([] as RunEntry[]))

vi.mock('../lib/api', () => ({
  api: { runEntries: () => entries() },
}))

const { RunDetail } = await import('./RunDetail')

afterEach(cleanup)

const code = { name: 'code', left: 'V:\\', right: 'E:\\backup\\code' } as Job

describe('a run that met a folder it could not read', () => {
  it('names the folder, the side and that nothing in it was touched', async () => {
    entries.mockResolvedValueOnce([
      { Kind: 'skip', Side: 'left', Path: 'claude/tmp/tmphqr9i89k', Note: 'unreadable', Size: 0 },
      { Kind: 'skip', Side: 'left', Path: 'claude/tmp/tmpq0x1', Note: 'vanished', Size: 0 },
      { Kind: 'copy', Side: 'right', Path: 'notes.md', Note: '', Size: 12 },
    ])
    render(
      <Places.Provider value={{ jobs: [code], drives: [] }}>
        <RunDetail run={7} job="code" />
      </Places.Provider>,
    )

    expect(await screen.findByText('Folder could not be read in V:')).toBeTruthy()
    expect(screen.getByText('Folder disappeared in V: while being read')).toBeTruthy()
    expect(screen.getByText('claude/tmp/tmphqr9i89k')).toBeTruthy()
    expect(
      screen.getAllByText('Nothing in it was copied or deleted on either side. The next run tries again.'),
    ).toHaveLength(2)
    // The engine's code is for the interface, not for the reader.
    expect(screen.queryByText('unreadable')).toBeNull()
  })
})
