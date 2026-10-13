// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Settings } from '../../lib/api'

const saveSettings = vi.fn((s: Settings) => Promise.resolve(s))
const testNotify = vi.fn((_channel: string, _notify: unknown) => Promise.resolve({ ok: true, reason: undefined as string | undefined }))
let stored: Settings = {}

vi.mock('../../lib/api', async (actual) => ({
  ...(await actual<typeof import('../../lib/api')>()),
  api: {
    settings: () => Promise.resolve(stored),
    saveSettings: (s: Settings) => saveSettings(s),
    jobs: () => Promise.resolve([{ name: 'photos' }]),
    testNotify: (channel: string, notify: unknown) => testNotify(channel, notify),
    remotes: () => Promise.resolve({ remotes: [{ name: 'nas' }, { name: 'cloud' }], backends: [] }),
    volumes: () => Promise.resolve({ volumes: [{ id: 'usb' }] }),
  },
}))

const { SyncPage } = await import('./SyncPage')
const { SafetyPage } = await import('./SafetyPage')
const { TargetsTile } = await import('./TargetsTile')
const { setNavPin } = await import('../../lib/navPins')

// jsdom cannot measure elements, which the selectors ask for.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

beforeEach(() => {
  saveSettings.mockClear()
  testNotify.mockClear()
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

describe('the Targets tile', () => {
  it('draws the whole page under its card while the page is not in the sidebar', async () => {
    render(<TargetsTile page={<p>the targets page</p>} />)
    expect(screen.getByText('the targets page')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
    expect(await screen.findByText('2')).toBeTruthy()
  })

  it('leaves the page to the sidebar once pinned and leads there', async () => {
    render(<TargetsTile page={<p>the targets page</p>} />)
    act(() => setNavPin('targets', true))
    expect(screen.queryByText('the targets page')).toBeNull()
    expect(screen.getByRole('switch', { name: 'Also show in the sidebar' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(window.location.pathname).toBe('/targets')
    expect(await screen.findByText('1')).toBeTruthy()
    window.history.replaceState(null, '', '/')
  })

  // The selector is the page-top rule in index.css that drops the first card
  // by half its badge, which would otherwise be cut off at the column's top.
  it('starts on a card the page top makes room for', async () => {
    const { container } = render(
      <div className="glim-page-enter">
        <TargetsTile page={<p>the targets page</p>} />
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

describe('the notification channels', () => {
  it('keep what a switched-off channel holds', async () => {
    stored = { notify: { smtp: { host: 'mail.example.org', from: 'a@example.org', to: 'b@example.org', password: '********' } } }
    const { unmount } = render(<SafetyPage />)
    expect(await screen.findByDisplayValue('mail.example.org')).toBeTruthy()

    // Webhook, Matrix, then mail.
    fireEvent.click(screen.getAllByRole('switch', { name: 'Send here' })[2]!)
    expect(screen.queryByDisplayValue('mail.example.org')).toBeNull()
    unmount()

    const smtp = saveSettings.mock.calls.at(-1)?.[0].notify?.smtp
    expect(smtp).toMatchObject({ enabled: false, host: 'mail.example.org', password: '********' })
  })

  it('send a test of what the card shows and say why it failed', async () => {
    stored = { notify: { webhook: '********', webhookFormat: 'ntfy' } }
    testNotify.mockResolvedValueOnce({ ok: false, reason: '403 Forbidden: topic is reserved' })
    render(<SafetyPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Send a test' }))

    expect(await screen.findByText('403 Forbidden: topic is reserved')).toBeTruthy()
    expect(testNotify).toHaveBeenCalledWith('webhook', expect.objectContaining({ webhook: '********', webhookFormat: 'ntfy' }))
  })

  it('read the older onSuccess as after every run, and write on once the choice changes', async () => {
    stored = { notify: { onSuccess: true } }
    const { unmount } = render(<SafetyPage />)
    const always = await screen.findByRole('tab', { name: 'After every run' })
    expect(always.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'When a run fails' }))
    unmount()

    const notify = saveSettings.mock.calls.at(-1)?.[0].notify
    expect(notify?.on).toBe('failure')
    expect(notify?.onSuccess).toBeUndefined()
  })
})
