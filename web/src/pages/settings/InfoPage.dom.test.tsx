// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, type DeskUpdate, type Settings, type WindowSettings } from '../../lib/api'
import { GLIMSTONE_VERSION } from '../../lib/glimstone/version'
import { CHANGES } from '../../lib/whatsNew'

const updateCheck = vi.fn()
const diagnostics = vi.fn(() => Promise.resolve('{"versions":{}}'))
const versions = vi.fn(() =>
  Promise.resolve<{
    arrowloop: string
    rclone: string
    go: string
    deployment?: string
    newRelease?: string
    checkedAt?: string
    installer?: string
  }>({
    arrowloop: 'v1.8.0',
    rclone: 'v1.75.2',
    go: 'go1.27.1',
  }),
)
const windowUpdate = vi.fn(() => Promise.resolve<DeskUpdate>({ busy: false, percent: -1 }))
const startUpdate = vi.fn(() => Promise.resolve<DeskUpdate>({ busy: true, percent: 0 }))
const restart = vi.fn(() => Promise.resolve({ restarting: true }))
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
    windowUpdate: () => windowUpdate(),
    startUpdate: () => startUpdate(),
    restart: () => restart(),
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
  localStorage.clear()
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


const titles = () => [...document.querySelectorAll('[data-glim$="Card"]')].map((card) => card.getAttribute('data-glim'))

describe('the Info tile', () => {
  it('stands in four cards: Version, Components, Help and About', async () => {
    render(<InfoPage version="v1.8.0" {...server} />)
    await screen.findByRole('link', { name: '1.75.2' })
    const order = titles().filter((name) => name !== 'Card')
    expect(order[0]).toBe('InfoVersionCard')
    expect(order[1]).toBe('InfoComponentsCard')
    expect(order.at(-1)).toBe('InfoAboutCard')
    expect(screen.getByText('About')).toBeTruthy()
    expect(screen.queryByText('About ArrowLoop')).toBeNull()
  })

  it('shows the app alone in the Version card, its number opening the newest release', async () => {
    render(<InfoPage version="v1.8.0" {...server} />)
    const card = document.querySelector('[data-glim="InfoVersionCard"]') as HTMLElement
    const number = await within(card).findByRole('link', { name: '1.8.0' })
    expect(number.getAttribute('href')).toBe('https://github.com/junkerderprovinz/arrowloop/releases/latest')
    expect(within(card).queryByText('rclone')).toBeNull()
  })

  it('lists rclone and GlimStone in the Components card, what they are behind the (i)', async () => {
    render(<InfoPage version="v1.8.0" {...server} />)
    const card = document.querySelector('[data-glim="InfoComponentsCard"]') as HTMLElement
    const rclone = await within(card).findByRole('link', { name: '1.75.2' })
    expect(rclone.getAttribute('href')).toBe('https://github.com/rclone/rclone/releases/latest')
    expect(within(card).getByRole('link', { name: GLIMSTONE_VERSION }).getAttribute('href')).toBe(
      'https://github.com/junkerderprovinz/glimstone/releases/latest',
    )
    expect(card.querySelector('.glim-version-sub')).toBeNull()
    expect(within(card).queryByText('PommelPorter')).toBeNull()
    expect(within(card).queryByRole('switch')).toBeNull()
  })

  it('names the installer of a desktop build last', async () => {
    versions.mockResolvedValueOnce({ arrowloop: 'v1.8.0', rclone: 'v1.75.2', go: 'go1.27.1', deployment: 'desktop', installer: 'v1.2.5' })
    render(<InfoPage version="v1.8.0" window={windowSettings} onWindow={() => {}} />)
    const card = document.querySelector('[data-glim="InfoComponentsCard"]') as HTMLElement
    await within(card).findByText('PommelPorter')
    const names = [...card.querySelectorAll('.glim-version-part')].map((n) => n.textContent)
    expect(names).toEqual(['rclone', 'GlimStone', 'PommelPorter'])
  })

  it('counts what is new on the one button to the changes', async () => {
    localStorage.setItem('arrowloop.whatsNew', JSON.stringify({ version: 'dev', from: '', seen: [] }))
    render(<InfoPage version="v1.8.0" {...server} />)
    await screen.findByRole('link', { name: '1.75.2' })
    expect(screen.getByRole('button', { name: `What's new · ${CHANGES.length}` })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Release notes' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^New/ })).toBeNull()
  })

  it('says where the updates stand and when the server last looked', async () => {
    versions.mockResolvedValueOnce({ arrowloop: 'v1.8.0', rclone: 'v1.75.2', go: 'go1.27.1', checkedAt: new Date(Date.now() - 3 * 60_000).toISOString() })
    render(<InfoPage version="v1.8.0" {...server} />)
    expect(await screen.findByText('Last checked 3 minutes ago')).toBeTruthy()
    expect(screen.getByText('Up to date')).toBeTruthy()
  })

  it("says why an update check could not run, in the reader's words", async () => {
    updateCheck.mockRejectedValue(new ApiError('GitHub answered HTTP 403', 502, 'rate-limited'))
    render(<InfoPage version="v1.8.0" {...server} />)
    await click('Check for updates')
    await waitFor(() => expect(screen.getByText('Check failed')).toBeTruthy())
    expect(screen.getByText('GitHub is turning away requests from this address for now. Try again in an hour.')).toBeTruthy()
  })

  it('leads a container to the guide once a newer release is out, and opens its notes', async () => {
    updateCheck.mockResolvedValue({ current: 'v1.8.0', latest: 'v1.9.0', updateAvailable: true, releaseUrl: '' })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<InfoPage version="v1.8.0" {...server} />)
    await click('Check for updates')
    await waitFor(() => expect(screen.getByText('Update to 1.9.0 available')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull()
    await click('How to update')
    await click("What's new")
    expect(open.mock.calls.map((c) => c[0])).toEqual([
      'https://junkerderprovinz.github.io/arrowloop/installing/#updates',
      'https://github.com/junkerderprovinz/arrowloop/releases/tag/v1.9.0',
    ])
  })

  it('names the newer release the daily check found', async () => {
    versions.mockResolvedValueOnce({ arrowloop: 'v1.8.0', rclone: 'v1.75.2', go: 'go1.27.1', deployment: 'container', newRelease: 'v1.9.0' })
    render(<InfoPage version="v1.8.0" {...server} />)
    expect(await screen.findByText('Update to 1.9.0 available')).toBeTruthy()
  })

  it('lets a container switch on the daily check for a new version', async () => {
    versions.mockResolvedValueOnce({ arrowloop: 'v1.8.0', rclone: 'v1.75.2', go: 'go1.27.1', deployment: 'container' })
    render(<InfoPage version="v1.8.0" {...server} />)
    const toggle = await screen.findByRole('switch', { name: 'Check for updates automatically' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ updateCheck: true }), { timeout: 3000 })
  })

  it('lets the desktop app update now, follows the download and restarts into it', async () => {
    updateCheck.mockResolvedValue({ current: 'v1.8.0', latest: 'v1.9.0', updateAvailable: true, releaseUrl: '' })
    windowUpdate.mockResolvedValueOnce({ busy: false, percent: -1 }).mockResolvedValue({ busy: true, percent: 40 })
    render(<InfoPage version="v1.8.0" window={windowSettings} onWindow={() => {}} />)
    await screen.findByRole('link', { name: '1.75.2' })
    await click('Check for updates')
    await click('Update now')
    expect(startUpdate).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('progressbar')).toBeTruthy())

    windowUpdate.mockResolvedValue({ busy: false, percent: 100, ready: '1.9.0' })
    await waitFor(() => expect(screen.getByText('1.9.0 is ready')).toBeTruthy(), { timeout: 3000 })
    await click('Restart for 1.9.0')
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('carries the update switch of the desktop app under its number', async () => {
    const onWindow = vi.fn()
    render(<InfoPage version="v1.8.0" window={windowSettings} onWindow={onWindow} />)
    await screen.findByRole('link', { name: '1.75.2' })
    fireEvent.click(screen.getByRole('switch', { name: 'Update automatically' }))
    expect(onWindow).toHaveBeenCalledWith({ ...windowSettings, autoUpdate: true })
  })

  it('says a Flatpak updates through Flathub and offers neither a switch nor a check', async () => {
    render(<InfoPage version="v1.8.0" window={{ ...windowSettings, updatesFromStore: true }} onWindow={() => {}} />)
    await screen.findByRole('link', { name: '1.75.2' })
    expect(screen.getByText('Updates come through Flathub.')).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull()
  })

  it('hands the bug report to the browser as a file', async () => {
    render(<InfoPage version="v1.8.0" {...server} />)
    await click(/Bug report/)
    await waitFor(() => expect(downloaded).toHaveBeenCalledTimes(1))
    expect(downloaded.mock.calls[0]?.[0]).toMatch(/^arrowloop-report-\d{4}-\d\d-\d\d\.json$/)
  })

  it('reaches GitHub, Discord and the manual through the system in the desktop build', async () => {
    const runtime = desktop('linux')
    const open = vi.spyOn(window, 'open')
    render(<InfoPage version="v1.0.0" {...server} />)
    await click('GitHub')
    await click('Discord')
    await click(/Manual/)
    await click('1.8.0', 'link')
    expect(runtime.BrowserOpenURL.mock.calls.map((c) => c[0])).toEqual([
      'https://github.com/junkerderprovinz/arrowloop',
      'https://discord.gg/XpMW5dgVRa',
      'https://junkerderprovinz.github.io/arrowloop/',
      'https://github.com/junkerderprovinz/arrowloop/releases/latest',
    ])
    expect(open).not.toHaveBeenCalled()
  })

  it('offers no mail route', () => {
    render(<InfoPage version="v1.0.0" {...server} />)
    expect(screen.queryByRole('button', { name: /mail/i })).toBeNull()
    expect(screen.getByText(/Problems, wishes or suggestions/).textContent).not.toMatch(/mail/i)
  })

  it('opens a new tab in a browser', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<InfoPage version="v1.0.0" {...server} />)
    await click('GitHub')
    expect(open).toHaveBeenCalledWith('https://github.com/junkerderprovinz/arrowloop', '_blank', 'noopener,noreferrer')
  })
})
