// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Settings } from '../lib/api'

const saveSettings = vi.fn((s: Settings) => Promise.resolve(s))

vi.mock('../lib/api', () => ({
  api: {
    settings: () => Promise.resolve({ defaults: { emptyDirs: false } }),
    saveSettings: (s: Settings) => saveSettings(s),
  },
}))

const { Engine } = await import('./Engine')

// jsdom cannot measure elements, which the selectors ask for.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

beforeEach(() => saveSettings.mockClear())
afterEach(cleanup)

describe('the engine settings', () => {
  it('saves a change made just before the section closes', async () => {
    const { unmount } = render(<Engine />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Carry empty folders' }))
    unmount()

    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(saveSettings.mock.calls[0][0].defaults?.emptyDirs).toBe(true)
  })

  it('sends a settled change once', async () => {
    const { unmount } = render(<Engine />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Carry empty folders' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1), { timeout: 2000 })
    unmount()

    expect(saveSettings).toHaveBeenCalledTimes(1)
  })
})
