// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Settings } from '../../lib/api'

const saveSettings = vi.fn((s: Settings) => Promise.resolve(s))
let stored: Settings = {}

vi.mock('../../lib/api', async (actual) => ({
  ...(await actual<typeof import('../../lib/api')>()),
  api: {
    settings: () => Promise.resolve(stored),
    saveSettings: (s: Settings) => saveSettings(s),
  },
}))

const { SyncPage } = await import('./SyncPage')
const { NotificationsPage } = await import('./NotificationsPage')
const { TargetsTile } = await import('./ModuleTiles')
const { setNavPin } = await import('../../lib/navPins')

// jsdom cannot measure elements, which the selectors ask for.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

beforeEach(() => {
  saveSettings.mockClear()
  stored = { defaults: { emptyDirs: false } }
  localStorage.clear()
})
afterEach(cleanup)

describe('a settings tile', () => {
  it('saves a change made just before the tile closes', async () => {
    const { unmount } = render(<SyncPage />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Carry empty folders' }))
    unmount()

    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(saveSettings.mock.calls[0]![0].defaults?.emptyDirs).toBe(true)
  })

  it('sends a settled change once', async () => {
    const { unmount } = render(<SyncPage />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Carry empty folders' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1), { timeout: 2000 })
    unmount()

    expect(saveSettings).toHaveBeenCalledTimes(1)
  })
})

describe('a stored secret', () => {
  it('shows as saved and keeps the saved one until something new is typed', async () => {
    stored = { notify: { webhook: '********' } }
    const { unmount } = render(<NotificationsPage />)
    expect(await screen.findByText('Saved')).toBeTruthy()
    expect(screen.queryByLabelText('Webhook')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep the saved one' }))
    unmount()

    expect(saveSettings.mock.calls.at(-1)?.[0].notify?.webhook).toBe('********')
  })
})

describe('a page that can stand in the sidebar', () => {
  it('draws the whole page on its tile while it is not pinned', () => {
    render(<TargetsTile page={<p>the targets page</p>} />)
    expect(screen.getByText('the targets page')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
  })

  it('keeps only the switch and the way to the page once pinned', () => {
    render(<TargetsTile page={<p>the targets page</p>} />)
    act(() => setNavPin('targets', true))
    expect(screen.queryByText('the targets page')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Also show in the sidebar' }).getAttribute('aria-checked')).toBe('true')
  })
})
