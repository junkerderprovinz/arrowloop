// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RELEASES } from '../../lib/whatsNew'
import { closeNewsWindow, markSeen, openNewsWindow, startWhatsNew } from '../../lib/whatsNewStore'
import { WhatsNewButton, WhatsNewHost } from './WhatsNew'

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

function engineAnswers(notes: typeof NOTES | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      notes
        ? new Response(JSON.stringify({ notes }), { status: 200 })
        : new Response(JSON.stringify({ error: 'down' }), { status: 502 }),
    ),
  )
}

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/settings/info')
  // Updated from the release before, so every change is unseen.
  localStorage.setItem('arrowloop.whatsNew', JSON.stringify({ version: RELEASES[0].after, after: '', seen: [] }))
  startWhatsNew('dev')
  closeNewsWindow()
  engineAnswers(NOTES)
})
afterEach(() => {
  cleanup()
  act(() => closeNewsWindow())
  vi.unstubAllGlobals()
})

const Card = () => (
  <>
    <WhatsNewButton />
    <WhatsNewHost />
  </>
)
const pressNew = () => fireEvent.click(screen.getByRole('button', { name: /^New/ }))
const showNotes = () => act(() => openNewsWindow('notes'))

describe('the New button', () => {
  it('counts only the changes nobody has clicked away', () => {
    render(<Card />)
    expect(screen.getByRole('button', { name: `New · ${all}` })).toBeTruthy()
    act(() => markSeen(['navigation']))
    expect(screen.getByRole('button', { name: `New · ${all - 1}` })).toBeTruthy()
  })

  it('drops the number once everything was seen', () => {
    act(() => markSeen(RELEASES[0].changes.map((c) => c.id)))
    render(<Card />)
    expect(screen.getByRole('button', { name: 'New' })).toBeTruthy()
  })

  it('opens the window on the list of changes while something is unseen', () => {
    render(<Card />)
    pressNew()
    expect(screen.getByRole('tab', { name: `Changes · ${all}`, selected: true })).toBeTruthy()
  })

  it('opens the window on the release notes once everything was seen', () => {
    act(() => markSeen(RELEASES[0].changes.map((c) => c.id)))
    render(<Card />)
    pressNew()
    expect(screen.getByRole('tab', { name: 'Release notes', selected: true })).toBeTruthy()
  })
})

describe('the window', () => {
  it('opens by itself on the release notes after an update', () => {
    localStorage.setItem('arrowloop.whatsNew', JSON.stringify({ version: RELEASES[0].after, after: '', seen: [] }))
    render(<WhatsNewHost />)
    act(() => startWhatsNew('dev'))
    expect(screen.getByRole('tab', { name: 'Release notes', selected: true })).toBeTruthy()
  })

  it('stays shut in a browser that never saw an older release', () => {
    localStorage.clear()
    render(<WhatsNewHost />)
    act(() => startWhatsNew('dev'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the notes of the running version', async () => {
    render(<Card />)
    showNotes()
    await screen.findByText('A reset code.')
    const releases = [...document.querySelectorAll('[data-release]')].map((el) => el.getAttribute('data-release'))
    expect(releases).toEqual(['v1.8.0'])
    expect(screen.getByRole('heading', { name: 'Added' })).toBeTruthy()
    expect(screen.getByText('app.key').tagName).toBe('CODE')
  })

  it('leads to the releases at the start of its foot and closes at its end', () => {
    render(<Card />)
    showNotes()
    const foot = [...document.querySelectorAll('.glim-modal-foot button')].map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(foot).toEqual(['All releases', 'Close'])
  })

  it('leaves a link to anything but the web as text', async () => {
    engineAnswers([NOTES[1]])
    render(<Card />)
    showNotes()
    await screen.findByText(/a link/)
    expect(screen.queryByRole('link', { name: 'a link' })).toBeNull()
  })

  it('says so when the engine cannot give the notes', async () => {
    engineAnswers(null)
    render(<Card />)
    showNotes()
    expect(await screen.findByText('The release notes could not be loaded. You can read them all on GitHub.')).toBeTruthy()
  })

  it('shows the notes without tabs for a release with no marked changes', () => {
    localStorage.setItem('arrowloop.whatsNew', JSON.stringify({ version: 'dev', after: 'none', seen: [] }))
    render(<WhatsNewHost />)
    showNotes()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
  })
})

describe('the list of what is new', () => {
  it('lists every change of the release', () => {
    render(<Card />)
    pressNew()
    expect(document.querySelectorAll('[data-change]')).toHaveLength(all)
  })

  it('dims what was seen', () => {
    act(() => markSeen(['navigation']))
    render(<Card />)
    pressNew()
    expect(document.querySelector('[data-change="navigation"]')?.hasAttribute('data-seen')).toBe(true)
  })

  it('marks everything as seen with one toggle and brings it all back with the same one', () => {
    render(<Card />)
    pressNew()
    fireEvent.click(screen.getByRole('button', { name: `Mark all as seen · ${all}` }))
    expect(document.querySelectorAll('[data-change][data-seen]')).toHaveLength(all)
    expect(screen.getByRole('tab', { name: 'Changes', selected: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `Show all again · ${all}` }))
    expect(document.querySelectorAll('[data-change][data-seen]')).toHaveLength(0)
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('closes on its way to the page of a change', () => {
    render(<Card />)
    pressNew()
    const row = document.querySelector('[data-change="job-page"]')!
    fireEvent.click(row.querySelector('button')!)
    expect(window.location.pathname).toBe('/jobs')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
