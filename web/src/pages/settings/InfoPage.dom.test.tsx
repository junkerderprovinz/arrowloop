// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../lib/api'
import { CHANGES } from '../../lib/whatsNew'

const updateCheck = vi.fn()
const diagnostics = vi.fn(() => Promise.resolve('{"versions":{}}'))
const pushed: { message: string; severity?: string }[] = []

vi.mock('../../lib/api', async (actual) => ({
  ...(await actual<typeof import('../../lib/api')>()),
  api: {
    versions: () => Promise.resolve({ arrowloop: 'v1.8.0', rclone: 'v1.75.2', go: 'go1.27.1' }),
    updateCheck: () => updateCheck(),
    diagnostics: () => diagnostics(),
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

async function click(name: string | RegExp, role = 'button') {
  await act(async () => {
    fireEvent.click(screen.getByRole(role, { name }))
  })
}

describe('the Info tile', () => {
  it('lists every version the build is made of, each linked to its release', async () => {
    render(<InfoPage version="v1.8.0" />)
    const rclone = await screen.findByRole('link', { name: '1.75.2' })
    expect(rclone.getAttribute('href')).toBe('https://github.com/rclone/rclone/releases/tag/v1.75.2')
    expect(screen.getByRole('link', { name: '1.8.0' }).getAttribute('href')).toBe(
      'https://github.com/junkerderprovinz/arrowloop/releases/tag/v1.8.0',
    )
    expect(screen.getByText('GlimStone')).toBeTruthy()
    expect(screen.getByRole('link', { name: '3.8.0' }).getAttribute('href')).toBe(
      'https://github.com/junkerderprovinz/glimstone/releases/tag/v3.8.0',
    )
  })

  it('has one button to the release notes and the changes, before the update check', async () => {
    localStorage.setItem('arrowloop.whatsNew', JSON.stringify({ version: 'dev', from: '', seen: [] }))
    render(<InfoPage version="v1.8.0" whatsNew={<button type="button">New · 3</button>} />)
    await screen.findByRole('link', { name: '1.75.2' })
    const buttons = [...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(buttons.slice(0, 2)).toEqual(['New · 3', 'Check for updates'])
    expect(screen.queryByRole('button', { name: 'Release notes' })).toBeNull()
  })

  it('offers the release notes in its place while no change is listed', async () => {
    localStorage.setItem('arrowloop.whatsNew', JSON.stringify({ version: 'dev', from: '', seen: CHANGES.map((c) => c.id) }))
    render(<InfoPage version="v1.8.0" whatsNew={<button type="button">New · 3</button>} />)
    await screen.findByRole('link', { name: '1.75.2' })
    expect(screen.getByRole('button', { name: 'Release notes' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New · 3' })).toBeNull()
  })

  it('says why an update check could not run, in the reader\'s words', async () => {
    updateCheck.mockRejectedValue(new ApiError('GitHub answered HTTP 403', 502, 'rate-limited'))
    render(<InfoPage version="v1.8.0" />)
    await click('Check for updates')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check failed' })).toBeTruthy())
    expect(pushed).toEqual([
      { message: 'GitHub is turning away requests from this address for now. Try again in an hour.', severity: 'fail' },
    ])
  })

  it('names a newer release', async () => {
    updateCheck.mockResolvedValue({ current: 'v1.8.0', latest: 'v1.9.0', updateAvailable: true, releaseUrl: '' })
    render(<InfoPage version="v1.8.0" />)
    await click('Check for updates')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update available' })).toBeTruthy())
    expect(pushed[0]?.message).toBe('ArrowLoop 1.9.0 is out.')
  })

  it('hands the bug report to the browser as a file', async () => {
    render(<InfoPage version="v1.8.0" />)
    await click(/Bug report/)
    await waitFor(() => expect(downloaded).toHaveBeenCalledTimes(1))
    expect(downloaded.mock.calls[0]?.[0]).toMatch(/^arrowloop-report-\d{4}-\d\d-\d\d\.json$/)
  })

  it('reaches GitHub, the mail program and the manual through the system in the desktop build', async () => {
    const runtime = desktop('linux')
    const open = vi.spyOn(window, 'open')
    render(<InfoPage version="v1.0.0" />)
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
    render(<InfoPage version="v1.0.0" />)
    await click('GitHub')
    expect(open).toHaveBeenCalledWith('https://github.com/junkerderprovinz/arrowloop', '_blank', 'noopener,noreferrer')
  })
})
