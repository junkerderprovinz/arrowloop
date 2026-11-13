// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, type Settings, type WindowSettings } from '../../lib/api'
import { CHANGES } from '../../lib/whatsNew'

const updateCheck = vi.fn()
const diagnostics = vi.fn(() => Promise.resolve('{"versions":{}}'))
const versions = vi.fn(() =>
  Promise.resolve<{ arrowloop: string; rclone: string; go: string; deployment?: string; newRelease?: string }>({
    arrowloop: 'v1.8.0',
    rclone: 'v1.75.2',
    go: 'go1.27.1',
  }),
)
const saveSettings = vi.fn((s: Settings) => Promise.resolve(s))
const pushed: { message: string; severity?: string }[] = []

vi.mock('../../lib/api', async (actual) => ({
  ...(await actual<typeof import('../../lib/api')>()),
  api: {
    versions: () => versions(),
    updateCheck: () => updateCheck(),
    diagnostics: () => diagnostics(),
    settings: () => Promise.resolve({}),
    saveSettings: (s: Settings) => saveSettings(s),
  },
}))
vi.mock('../../lib/toast', () => ({
  useToast: () => (message: string, severity?: string) => pushed.push({ message, severity }),
}))
const downloaded = vi.fn()
vi.mock('../../lib/download', () => ({ download: (...args: unknown[]) => downloaded(...args) }))

const { InfoPage } = await import('./InfoPage')

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

beforeEach(() => {
  pushed.length = 0
  updateCheck.mockReset()
  downloaded.mockReset()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (window as unknown as { runtime?: unknown }).runtime
})

// The part of the Wails runtime the tile uses, as the desktop build injects it.
function desktop(platform: string) {
  const runtime = {
    BrowserOpenURL: vi.fn(),
    Environment: vi.fn(async () => ({ buildType: 'production', platform, arch: 'amd64' })),
  }
  ;(window as unknown as { runtime?: typeof runtime }).runtime = runtime
  return runtime
}

const windowSettings: WindowSettings = {
  tray: false,
  closeToTray: false,
  minimiseToTray: false,
  startWithSystem: false,
  canStartWithSystem: true,
  autoUpdate: false,
  updatesFromStore: false,
}

// A build with no window of its own: the container, or the web page beside it.
const server = { window: null, onWindow: () => {} }

async function click(name: string | RegExp, role = 'button') {
  await act(async () => {
    fireEvent.click(screen.getByRole(role, { name }))
  })
}

describe('the Info tile', () => {
  it('lists every version the build is made of, each linked to its release', async () => {
    render(<InfoPage version="v1.8.0" {...server} />)
    const rclone = await screen.findByRole('link', { name: '1.75.2' })
    expect(rclone.getAttribute('href')).toBe('https://github.com/rclone/rclone/releases/tag/v1.75.2')
    expect(screen.getByRole('link', { name: '1.8.0' }).getAttribute('href')).toBe(
      'https://github.com/junkerderprovinz/arrowloop/releases/tag/v1.8.0',
    )
    expect(screen.getByText('GlimStone')).toBeTruthy()
    expect(screen.getByRole('link', { name: '4.4.1' }).getAttribute('href')).toBe(
      'https://github.com/junkerderprovinz/glimstone/releases/tag/v4.4.1',
    )
  })

  it('has one button to the release notes and the changes, before the update check', async () => {
    localStorage.setItem('arrowloop.whatsNew', JSON.stringify({ version: 'dev', from: '', seen: [] }))
    render(<InfoPage version="v1.8.0" whatsNew={<button type="button">New · 3</button>} {...server} />)
    await screen.findByRole('link', { name: '1.75.2' })
    const buttons = [...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(buttons.slice(0, 2)).toEqual(['New · 3', 'Check for updates'])
    expect(screen.queryByRole('button', { name: 'Release notes' })).toBeNull()
  })

  it('offers the release notes in its place while no change is listed', async () => {
    localStorage.setItem('arrowloop.whatsNew', JSON.stringify({ version: 'dev', from: '', seen: CHANGES.map((c) => c.id) }))
    render(<InfoPage version="v1.8.0" whatsNew={<button type="button">New · 3</button>} {...server} />)
    await screen.findByRole('link', { name: '1.75.2' })
    expect(screen.getByRole('button', { name: 'Release notes' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New · 3' })).toBeNull()
  })

  it('says why an update check could not run, in the reader\'s words', async () => {
    updateCheck.mockRejectedValue(new ApiError('GitHub answered HTTP 403', 502, 'rate-limited'))
    render(<InfoPage version="v1.8.0" {...server} />)
    await click('Check for updates')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check failed' })).toBeTruthy())
    expect(pushed).toEqual([
      { message: 'GitHub is turning away requests from this address for now. Try again in an hour.', severity: 'fail' },
    ])
  })

  it('names a newer release', async () => {
    updateCheck.mockResolvedValue({ current: 'v1.8.0', latest: 'v1.9.0', updateAvailable: true, releaseUrl: '' })
    render(<InfoPage version="v1.8.0" {...server} />)
    await click('Check for updates')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update available' })).toBeTruthy())
    expect(pushed[0]?.message).toBe('ArrowLoop 1.9.0 is out.')
  })

  it('hands the bug report to the browser as a file', async () => {
    render(<InfoPage version="v1.8.0" {...server} />)
    await click(/Bug report/)
    await waitFor(() => expect(downloaded).toHaveBeenCalledTimes(1))
    expect(downloaded.mock.calls[0]?.[0]).toMatch(/^arrowloop-report-\d{4}-\d\d-\d\d\.json$/)
  })

  it('reaches GitHub, the mail program and the manual through the system in the desktop build', async () => {
    const runtime = desktop('linux')
    const open = vi.spyOn(window, 'open')
    render(<InfoPage version="v1.0.0" {...server} />)
    await click('GitHub')
    await click('Email')
    await click(/Manual/)
    await click('1.8.0', 'link')
    expect(runtime.BrowserOpenURL.mock.calls.map((c) => c[0])).toEqual([
      'https://github.com/junkerderprovinz/arrowloop',
      'mailto:hello@halleluja.design?subject=ArrowLoop%20Feedback',
      'https://junkerderprovinz.github.io/arrowloop/',
      'https://github.com/junkerderprovinz/arrowloop/releases/tag/v1.8.0',
    ])
    expect(open).not.toHaveBeenCalled()
  })

  it('opens a new tab in a browser', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<InfoPage version="v1.0.0" {...server} />)
    await click('GitHub')
    expect(open).toHaveBeenCalledWith('https://github.com/junkerderprovinz/arrowloop', '_blank', 'noopener,noreferrer')
  })

  it('carries the update switch of the desktop app under the versions', async () => {
    const onWindow = vi.fn()
    render(<InfoPage version="v1.8.0" window={windowSettings} onWindow={onWindow} />)
    await screen.findByRole('link', { name: '1.75.2' })
    fireEvent.click(screen.getByRole('switch', { name: 'Update automatically' }))
    expect(onWindow).toHaveBeenCalledWith({ ...windowSettings, autoUpdate: true })
  })

  it('puts the update switch right under the app, ahead of what it is made of', async () => {
    render(<InfoPage version="v1.8.0" window={windowSettings} onWindow={() => {}} />)
    await screen.findByRole('link', { name: '1.75.2' })
    const toggle = screen.getByRole('switch', { name: 'Update automatically' })
    const glimstone = screen.getByText('GlimStone')
    expect(toggle.compareDocumentPosition(glimstone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says a Flatpak updates through the software centre instead of offering the switch', async () => {
    render(<InfoPage version="v1.8.0" window={{ ...windowSettings, updatesFromStore: true }} onWindow={() => {}} />)
    await screen.findByRole('link', { name: '1.75.2' })
    expect(screen.getByText('Updates come through your software centre')).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'Update automatically' })).toBeNull()
  })

  it('offers no update switch where there is no desktop app', async () => {
    render(<InfoPage version="v1.8.0" {...server} />)
    await screen.findByRole('link', { name: '1.75.2' })
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('lets a container switch on the daily check for a new version', async () => {
    versions.mockResolvedValueOnce({ arrowloop: 'v1.8.0', rclone: 'v1.75.2', go: 'go1.27.1', deployment: 'container' })
    render(<InfoPage version="v1.8.0" {...server} />)
    const toggle = await screen.findByRole('switch', { name: 'Update automatically' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect((toggle as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(toggle)
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ updateCheck: true }), { timeout: 3000 })
  })

  it('names the newer release the daily check found under the app', async () => {
    versions.mockResolvedValueOnce({ arrowloop: 'v1.8.0', rclone: 'v1.75.2', go: 'go1.27.1', deployment: 'container', newRelease: 'v1.9.0' })
    render(<InfoPage version="v1.8.0" {...server} />)
    expect(await screen.findByText('ArrowLoop 1.9.0 is out.')).toBeTruthy()
  })
})
