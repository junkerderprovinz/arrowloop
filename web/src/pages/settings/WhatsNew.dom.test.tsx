// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RELEASES } from '../../lib/whatsNew'
import { markSeen, startWhatsNew } from '../../lib/whatsNewStore'
import { WhatsNewButton } from './WhatsNew'

const all = RELEASES[0].changes.length

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

const NOTES = [
  { version: 'v1.8.0', body: '## Added\n\n- **A reset code.** Written into the log, see `app.key`.' },
  { version: 'v1.7.0', body: 'A paragraph with [a link](javascript:alert(1)).' },
]

function engineAnswers(ok: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      ok
        ? new Response(JSON.stringify({ notes: NOTES }), { status: 200 })
        : new Response(JSON.stringify({ error: 'down' }), { status: 502 }),
    ),
  )
}

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/settings/info')
  startWhatsNew('dev', true)
  engineAnswers(true)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const open = () => fireEvent.click(screen.getByRole('button', { name: /^New/ }))
const showChanges = () => fireEvent.click(screen.getByRole('tab', { name: 'Changes' }))

describe('the New button', () => {
  it('counts only the changes nobody has clicked away', () => {
    render(<WhatsNewButton />)
    expect(screen.getByRole('button', { name: `New · ${all}` })).toBeTruthy()
    act(() => markSeen(['navigation']))
    expect(screen.getByRole('button', { name: `New · ${all - 1}` })).toBeTruthy()
  })

  it('drops the number once everything was seen', () => {
    act(() => markSeen(RELEASES[0].changes.map((c) => c.id)))
    render(<WhatsNewButton />)
    expect(screen.getByRole('button', { name: 'New' })).toBeTruthy()
  })
})

describe('the changelog', () => {
  it('opens first, with the release notes newest first', async () => {
    render(<WhatsNewButton />)
    open()
    expect(screen.getByRole('tab', { name: 'Changelog', selected: true })).toBeTruthy()
    await screen.findByText('A reset code.')
    const releases = [...document.querySelectorAll('[data-release]')].map((el) => el.getAttribute('data-release'))
    expect(releases).toEqual(['v1.8.0', 'v1.7.0'])
    expect(screen.getByRole('heading', { name: 'Added' })).toBeTruthy()
    expect(screen.getByText('app.key').tagName).toBe('CODE')
    expect(screen.getByRole('button', { name: 'All releases' })).toBeTruthy()
  })

  it('leaves a link to anything but the web as text', async () => {
    render(<WhatsNewButton />)
    open()
    await screen.findByText('A reset code.')
    expect(screen.queryByRole('link', { name: 'a link' })).toBeNull()
    expect(screen.getByText(/a link/)).toBeTruthy()
  })

  it('says so when the engine cannot give the notes', async () => {
    engineAnswers(false)
    render(<WhatsNewButton />)
    open()
    expect(await screen.findByText('The release notes could not be loaded. You can read them all on GitHub.')).toBeTruthy()
  })
})

describe('the list of what is new', () => {
  it('lists every change of the release', () => {
    render(<WhatsNewButton />)
    open()
    showChanges()
    expect(document.querySelectorAll('[data-change]')).toHaveLength(all)
  })

  it('dims what was seen', () => {
    act(() => markSeen(['navigation']))
    render(<WhatsNewButton />)
    open()
    showChanges()
    expect(document.querySelector('[data-change="navigation"]')?.hasAttribute('data-seen')).toBe(true)
  })

  it('marks everything as seen with one button and brings it all back with the same one', () => {
    render(<WhatsNewButton />)
    open()
    showChanges()
    fireEvent.click(screen.getByRole('button', { name: `Mark all as seen · ${all}` }))
    expect(document.querySelectorAll('[data-change][data-seen]')).toHaveLength(all)
    fireEvent.click(screen.getByRole('button', { name: `Show all again · ${all}` }))
    expect(document.querySelectorAll('[data-change][data-seen]')).toHaveLength(0)
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('closes on its way to the page of a change', () => {
    render(<WhatsNewButton />)
    open()
    showChanges()
    const row = document.querySelector('[data-change="job-page"]')!
    fireEvent.click(row.querySelector('button')!)
    expect(window.location.pathname).toBe('/jobs')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
