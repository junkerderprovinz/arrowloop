// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RawJob, Settings } from '../../lib/api'

const saveSettings = vi.fn((s: Settings) => Promise.resolve(s))
const testNotify = vi.fn((_channel: string, _notify: unknown) => Promise.resolve({ ok: true, reason: undefined as string | undefined }))
let stored: Settings = {}
let jobs: RawJob[] = []
const saveConfig = vi.fn((next: RawJob[]) => Promise.resolve({ jobs: next }))

vi.mock('../../lib/api', async (actual) => ({
  ...(await actual<typeof import('../../lib/api')>()),
  api: {
    settings: () => Promise.resolve(stored),
    saveSettings: (s: Settings) => saveSettings(s),
    jobs: () => Promise.resolve([{ name: 'photos' }]),
    config: () => Promise.resolve({ jobs }),
    saveConfig: (next: RawJob[]) => saveConfig(next),
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
  jobs = [{ name: 'photos' }]
  saveConfig.mockClear()
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

describe('the exceptions', () => {
  it('stay away while every job follows the defaults', async () => {
    render(<SyncPage />)
    await screen.findByRole('switch', { name: 'Carry empty folders' })
    expect(screen.queryByText('Exceptions')).toBeNull()
  })

  it('list only the jobs that differ, with what differs', async () => {
    jobs = [{ name: 'photos' }, { name: 'music', schedule: '', emptyDirs: true }]
    render(<SyncPage />)
    const row = (await screen.findByText('music')).closest('li') as HTMLElement
    expect(row.textContent).toContain('Schedule: on request')
    expect(row.textContent).toContain('Carry empty folders: On')
    expect(screen.queryByText('photos')).toBeNull()
  })

  it('give a job back to the defaults after asking, and go once none differs', async () => {
    jobs = [{ name: 'photos' }, { name: 'music', schedule: '', emptyDirs: true, brakePercent: 20 }]
    render(<SyncPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Use the default' }))
    const ask = await screen.findByRole('dialog', { name: 'Use the default?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Use the default' }))

    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1))
    const music = saveConfig.mock.calls[0]![0].find((j) => j.name === 'music')
    expect(music).toEqual({ name: 'music', brakePercent: 20 })
    await waitFor(() => expect(screen.queryByText('Exceptions')).toBeNull())
  })

  it('of the brakes stand on the safety net, not on sync', async () => {
    jobs = [{ name: 'music', brakePercent: 20 }]
    const { unmount } = render(<SyncPage />)
    await screen.findByRole('switch', { name: 'Carry empty folders' })
    expect(screen.queryByText('Exceptions')).toBeNull()
    unmount()

    render(<SafetyPage />)
    const row = (await screen.findByText('music')).closest('li') as HTMLElement
    expect(row.textContent).toContain('20 %')
  })
})

describe('the default schedule', () => {
  it('reads as a sentence and keeps a typed expression reachable', async () => {
    stored = { defaults: { schedule: '15 4 * * 1' } }
    render(<SyncPage />)
    const sentence = await screen.findByRole('button', { name: /^Schedule:/ })
    expect(sentence.textContent).toContain('Mon at 04:15')

    fireEvent.click(sentence)
    const panel = await screen.findByRole('dialog', { name: 'Schedule' })
    // Real time belongs to a job, so the default does not offer it.
    expect(within(panel).queryByRole('tab', { name: 'Real time' })).toBeNull()
    fireEvent.click(within(panel).getByRole('tab', { name: 'Cron' }))
    const field = within(panel).getByDisplayValue('15 4 * * 1')
    // Typed one key at a time, the space between two fields stays.
    fireEvent.change(field, { target: { value: '0 ' } })
    expect((field as HTMLInputElement).value).toBe('0 ')
  })
})

describe('a search result', () => {
  it('on the tile already open, scrolls to its card and rings it', async () => {
    const { Settings } = await import('./Settings')
    const { openSetting, takeJump } = await import('./SettingsSearch')
    const { settingsTiles } = await import('./tiles')
    window.history.replaceState(null, '', '/settings/sync')
    Element.prototype.scrollIntoView ??= () => undefined
    window.matchMedia ??= ((media: string) => ({
      matches: false,
      media,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined)
    render(
      <Settings
        tile="sync"
        tiles={settingsTiles(true)}
        look={{} as never}
        version="1.0.0"
        window={null}
        onWindow={() => undefined}
        targets={null}
      />,
    )
    await screen.findByRole('switch', { name: 'Carry empty folders' })
    act(() => openSetting('sync', { card: 'Global sync settings' }))
    await waitFor(() => expect(scrolled).toHaveBeenCalled())
    expect((scrolled.mock.contexts[0] as HTMLElement).classList.contains('glim-search-hit')).toBe(true)
    expect(takeJump()).toBeNull()
    scrolled.mockRestore()
    window.history.replaceState(null, '', '/')
  })
})
