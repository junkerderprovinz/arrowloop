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
const { SafetyPage } = await import('./SafetyPage')
const { TargetsTab } = await import('./TargetsTab')
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

describe('a settings tab', () => {
  it('saves a change made just before the tab closes', async () => {
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
    const { unmount } = render(<SafetyPage />)
    expect(await screen.findByText('Saved')).toBeTruthy()
    expect(screen.queryByLabelText('Webhook')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep the saved one' }))
    unmount()

    expect(saveSettings.mock.calls.at(-1)?.[0].notify?.webhook).toBe('********')
  })
})

describe('the anomalies switch', () => {
  it('takes the notes away and keeps the held message', async () => {
    const { unmount } = render(<SafetyPage />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Anomalies' }))
    expect(screen.queryByText('Failed runs in a row')).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Report notes too' })).toBeNull()
    expect(screen.getByRole('switch', { name: 'Report a held job' })).toBeTruthy()
    unmount()

    expect(saveSettings.mock.calls.at(-1)?.[0].anomalies?.off).toBe(true)
  })
})

describe('the Targets tab', () => {
  it('draws the whole page, pinned or not', () => {
    render(<TargetsTab page={<p>the targets page</p>} />)
    expect(screen.getByText('the targets page')).toBeTruthy()
    act(() => setNavPin('targets', true))
    expect(screen.getByText('the targets page')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Also show in the sidebar' }).getAttribute('aria-checked')).toBe('true')
  })

  // The selector is the page-top rule in index.css that drops the first card
  // by half its badge, which would otherwise be cut off at the column's top.
  it('starts on a card the page top makes room for', async () => {
    const { container } = render(
      <div className="glim-page-enter">
        <TargetsTab page={<p>the targets page</p>} />
      </div>,
    )
    await screen.findByRole('switch', { name: 'Also show in the sidebar' })
    const first = container.querySelector('.glim-notch-card')
    expect(first?.textContent).toContain('Targets')
    const roomy = container.querySelector(
      ['.glim-page-enter > .glim-notch-card:first-child', '.glim-page-enter > :first-child > .glim-notch-card:first-child'].join(', '),
    )
    expect(roomy).toBe(first)
  })
})
