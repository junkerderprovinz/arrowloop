// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RawJob, Settings } from '../../lib/api'

const saveSettings = vi.fn((s: Settings) => Promise.resolve(s))
const testNotify = vi.fn((_channel: unknown) =>
  Promise.resolve({ ok: true } as { ok: boolean; code?: string; status?: number; reason?: string }),
)
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
    testNotify: (channel: unknown) => testNotify(channel),
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
Element.prototype.scrollIntoView ??= () => undefined
window.matchMedia ??= ((media: string) => ({
  matches: false,
  media,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia

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

describe('two tiles', () => {
  it('keep a change made on one when the other is changed right after', async () => {
    // The engine takes a moment over a save, and a read before then gets the old settings.
    saveSettings.mockImplementation(
      (s: Settings) =>
        new Promise((done) =>
          setTimeout(() => {
            stored = { ...stored, ...s }
            done(stored)
          }, 50),
        ),
    )
    const safety = render(<SafetyPage />)
    const floor = await screen.findByRole('spinbutton', { name: 'Below this many files, no brake' })
    fireEvent.change(floor, { target: { value: '20' } })
    fireEvent.blur(floor)
    safety.unmount()

    render(<SyncPage />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Carry empty folders' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(2), { timeout: 2000 })
    await waitFor(() => expect(stored.defaults).toMatchObject({ brakeFloor: 20, emptyDirs: true }))
    saveSettings.mockImplementation((s: Settings) => Promise.resolve(s))
  })
})

describe('a stored secret', () => {
  it('shows as saved and keeps the saved one until something new is typed', async () => {
    stored = { notify: { channels: [{ id: 'd', kind: 'discord', enabled: true, discord: { url: '********' } }] } }
    const { unmount } = render(<SafetyPage />)
    expect(await screen.findByText('Saved')).toBeTruthy()
    expect(screen.queryByLabelText('Address')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep the saved one' }))
    unmount()

    expect(saveSettings.mock.calls.at(-1)?.[0].notify?.channels?.[0]?.discord?.url).toBe('********')
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
    stored = {
      notify: {
        channels: [
          { id: 'mail', kind: 'smtp', enabled: true, smtp: { host: 'mail.example.org', from: 'a@example.org', to: 'b@example.org', password: '********' } },
        ],
      },
    }
    const { unmount } = render(<SafetyPage />)
    expect(await screen.findByDisplayValue('mail.example.org')).toBeTruthy()

    fireEvent.click(screen.getByRole('switch', { name: 'Send here' }))
    expect(screen.queryByDisplayValue('mail.example.org')).toBeNull()
    unmount()

    const mail = saveSettings.mock.calls.at(-1)?.[0].notify?.channels?.[0]
    expect(mail).toMatchObject({ enabled: false, smtp: { host: 'mail.example.org', password: '********' } })
  })

  it("send a test of what the card shows and say why it failed in the reader's own words", async () => {
    stored = { notify: { channels: [{ id: 'phone', kind: 'ntfy', enabled: true, ntfy: { url: '********' } }] } }
    testNotify.mockResolvedValueOnce({ ok: false, code: 'rejected', status: 403, reason: 'the server answered 403 Forbidden' })
    render(<SafetyPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Send a test' }))

    expect(await screen.findByText('The server turned the message down. (HTTP 403)')).toBeTruthy()
    expect(testNotify).toHaveBeenCalledWith(expect.objectContaining({ id: 'phone', kind: 'ntfy', ntfy: { url: '********' } }))
  })

  it('add a channel of the chosen service under an id of its own', async () => {
    stored = { notify: { channels: [{ id: 'discord', kind: 'discord', enabled: true, discord: { url: '********' } }] } }
    const { unmount } = render(<SafetyPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a channel' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Discord' }))
    unmount()

    const channels = saveSettings.mock.calls.at(-1)?.[0].notify?.channels
    expect(channels?.map((c) => c.id)).toEqual(['discord', 'discord-2'])
    expect(channels?.[1]).toMatchObject({ kind: 'discord', enabled: true, on: 'failure' })
  })

  it('give each channel its own when', async () => {
    stored = {
      notify: {
        channels: [
          { id: 'a', kind: 'slack', enabled: true, on: 'failure', slack: { url: '********' } },
          { id: 'b', kind: 'slack', enabled: true, on: 'always', slack: { url: '********' } },
        ],
      },
    }
    const { unmount } = render(<SafetyPage />)
    const selected = () => screen.getAllByRole('tab', { name: 'After every run' }).map((tab) => tab.getAttribute('aria-selected'))
    await waitFor(() => expect(selected()).toEqual(['false', 'true']))
    fireEvent.click(screen.getAllByRole('tab', { name: 'After every run' })[0]!)
    unmount()

    const channels = saveSettings.mock.calls.at(-1)?.[0].notify?.channels
    expect(channels?.map((c) => c.on)).toEqual(['always', 'always'])
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
    expect(row.textContent).toContain('Schedule: manually')
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
  it('shows the chosen kind with its fields and keeps a typed expression reachable', async () => {
    stored = { defaults: { schedule: '15 4 * * 1' } }
    render(<SyncPage />)
    const kinds = await screen.findByRole('tablist', { name: 'Schedule' })
    expect(within(kinds).getByRole('tab', { name: 'Weekdays' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: 'Mon' }).getAttribute('aria-pressed')).toBe('true')
    // Real time belongs to a job, so the default does not offer it.
    expect(within(kinds).queryByRole('tab', { name: 'Real time' })).toBeNull()

    fireEvent.click(within(kinds).getByRole('tab', { name: 'Cron' }))
    const field = screen.getByDisplayValue('15 4 * * 1')
    // Typed one key at a time, the space between two fields stays.
    fireEvent.change(field, { target: { value: '0 ' } })
    expect((field as HTMLInputElement).value).toBe('0 ')
  })
})

describe('the settings search', () => {
  async function syncTile(extra?: ReactNode) {
    const { Settings } = await import('./Settings')
    const { settingsTiles } = await import('./tiles')
    window.history.replaceState(null, '', '/settings/sync')
    render(
      <>
        <Settings
          tile="sync"
          tiles={settingsTiles(true)}
          look={{} as never}
          version="1.0.0"
          window={null}
          onWindow={() => undefined}
          targets={null}
        />
        {extra}
      </>,
    )
    await screen.findByRole('switch', { name: 'Carry empty folders' })
  }

  it('leaves the focus in an open window on Ctrl+K and the slash', async () => {
    const { Dialog } = await import('../../components/Dialog')
    await syncTile(
      <Dialog title="Edit" onClose={() => undefined}>
        <button type="button">Inside</button>
      </Dialog>,
    )
    const inside = screen.getByRole('button', { name: 'Inside' })
    inside.focus()
    fireEvent.keyDown(inside, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(inside, { key: '/' })
    expect(document.activeElement).toBe(inside)
    window.history.replaceState(null, '', '/')
  })

  it('on the tile already open, scrolls a result to its card and rings it', async () => {
    const { openSetting, takeJump } = await import('./SettingsSearch')
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined)
    await syncTile()
    act(() => openSetting('sync', { card: 'Global sync settings' }))
    await waitFor(() => expect(scrolled).toHaveBeenCalled())
    expect((scrolled.mock.contexts[0] as HTMLElement).classList.contains('glim-search-hit')).toBe(true)
    expect(takeJump()).toBeNull()
    scrolled.mockRestore()
    window.history.replaceState(null, '', '/')
  })
})
