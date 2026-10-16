// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { en } from '../../lib/i18n.data'
import { CHANGES, placed } from '../../lib/whatsNew'
import { closeNewsWindow, markSeen, openNewsWindow, startWhatsNew } from '../../lib/whatsNewStore'
import { WhatsNewButton, WhatsNewHost } from './WhatsNew'

const KEY = 'arrowloop.whatsNew'
const RUNNING = 'v2.3.0'
// 2.2.1 and 2.1.0 brought fixes only: the engine has their notes, the list no changes.
const RELEASES = ['v2.3.0', 'v2.2.1', 'v2.2.0', 'v2.1.0', 'v2.0.0', 'v1.9.0']
const all = CHANGES.length
const unplaced = CHANGES.filter((c) => !placed(c))

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

type Note = { version: string; body: string }
const noteOf = (version: string): Note => ({ version, body: `## Added\n\n- **Notes of ${version}.** See \`app.key\`.` })

function engineAnswers(notes: Note[] | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      notes
        ? new Response(JSON.stringify({ notes }), { status: 200 })
        : new Response(JSON.stringify({ error: 'down' }), { status: 502 }),
    ),
  )
}

/** A browser that had `from` open and is updated to `running`. */
function updated(from: string, running = RUNNING) {
  localStorage.setItem(KEY, JSON.stringify({ version: from, from: '', seen: CHANGES.map((c) => c.id) }))
  act(() => startWhatsNew(running))
  act(() => closeNewsWindow())
}

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/settings/info')
  engineAnswers(RELEASES.map(noteOf))
  updated('v1.9.0')
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
const line = (id: string) => document.querySelector<HTMLElement>(`[data-change="${id}"]`)!
const card = (name: string) => document.querySelector<HTMLElement>(`[data-release="${name}"]`)!
const cards = () => [...document.querySelectorAll<HTMLElement>('[data-release]')].map((el) => el.dataset.release)

async function openWindow() {
  render(<Card />)
  act(() => openNewsWindow())
  await screen.findByText('Notes of v2.3.0.')
}

describe('the New button', () => {
  it('counts only the changes nobody has clicked away', () => {
    render(<Card />)
    expect(screen.getByRole('button', { name: `New · ${all}` })).toBeTruthy()
    act(() => markSeen(['navigation']))
    expect(screen.getByRole('button', { name: `New · ${all - 1}` })).toBeTruthy()
  })

  it('drops the number once everything was seen', () => {
    act(() => markSeen(CHANGES.map((c) => c.id)))
    render(<Card />)
    expect(screen.getByRole('button', { name: 'New' })).toBeTruthy()
  })

  it('opens the window on what came since the release before', () => {
    render(<Card />)
    fireEvent.click(screen.getByRole('button', { name: /^New/ }))
    expect(screen.getByRole('dialog', { name: 'New since 1.9.0' })).toBeTruthy()
  })
})

describe('the window', () => {
  it('opens by itself after an update', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 'v2.2.0', from: '', seen: [] }))
    render(<WhatsNewHost />)
    act(() => startWhatsNew(RUNNING))
    expect(screen.getByRole('dialog', { name: 'New since 2.2.0' })).toBeTruthy()
  })

  it('stays shut in a browser that never saw an older release', () => {
    localStorage.clear()
    render(<WhatsNewHost />)
    act(() => startWhatsNew(RUNNING))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('leads to the releases at the start of its foot and closes at its end', async () => {
    await openWindow()
    const foot = [...document.querySelectorAll('.glim-modal-foot button')].map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(foot).toEqual(['All releases', 'Close'])
  })

  it('says so when the engine cannot give the notes, and still lists the changes', async () => {
    engineAnswers(null)
    render(<Card />)
    act(() => openNewsWindow())
    expect(await screen.findByText(en['new.loadFailed'])).toBeTruthy()
    expect(cards()).toEqual(['2.3.0'])
    expect(document.querySelectorAll('[data-change]')).toHaveLength(all)
  })
})

describe('the cards', () => {
  it('show every release since the one the browser had, newest first, each with its own changes', async () => {
    await openWindow()
    expect(cards()).toEqual(['2.3.0', '2.2.1', '2.2.0', '2.1.0', '2.0.0'])
    expect(within(card('2.3.0')).queryByText(en['new.change.releaseCards'])).toBeTruthy()
    expect(within(card('2.2.0')).queryAllByText(/Apps\.$/)).toHaveLength(1)
    expect(card('2.2.1').querySelectorAll('[data-change]')).toHaveLength(0)
    expect(card('2.0.0').querySelector('[data-change="navigation"]')).not.toBeNull()
  })

  it('show the notes of every release under its number on the badge', async () => {
    await openWindow()
    for (const name of ['2.3.0', '2.2.1']) {
      expect(within(card(name)).getByRole('heading', { level: 3, name })).toBeTruthy()
      expect(within(card(name)).getByText(`Notes of v${name}.`)).toBeTruthy()
    }
    expect(within(card('2.3.0')).getByText('app.key').tagName).toBe('CODE')
  })

  it('show older releases only while they hold something unseen', async () => {
    updated('v2.2.0')
    await openWindow()
    expect(cards()).toEqual(['2.3.0', '2.2.1'])
    expect(screen.getByRole('dialog', { name: 'New since 2.2.0' })).toBeTruthy()
    act(() => markSeen(['navigation'], false))
    expect(cards()).toEqual(['2.3.0', '2.2.1', '2.0.0'])
  })

  it('name each change under its page, and those no page draws first', async () => {
    await openWindow()
    // The notes bring headings of their own; the pages come after them.
    const pages = (el: HTMLElement) => [...el.querySelectorAll('ul > li[data-change]')].map((li) => li.closest('div')!.querySelector('h4')!.textContent)
    expect(pages(card('2.0.0'))).toContain('Settings › Look')
    for (const change of unplaced) {
      expect(pages(line(change.id).closest('[data-release]') as HTMLElement)[0]).toBe(en['new.where.background'])
      expect(within(line(change.id)).queryByRole('button')).toBeNull()
    }
  })

  it('show only the running release in a browser that saw no older one', async () => {
    localStorage.clear()
    act(() => startWhatsNew(RUNNING))
    await openWindow()
    expect(cards()).toEqual(['2.3.0'])
    expect(screen.getByRole('dialog', { name: 'New in 2.3.0' })).toBeTruthy()
    expect(card('2.3.0').querySelectorAll('[data-change]:not([data-seen])')).toHaveLength(0)
  })

  it('give a build of what comes next its own card above the release it starts from', async () => {
    engineAnswers(['v2.2.3', 'v2.2.2'].map(noteOf))
    updated('v2.2.3', 'v2.2.3-4-gabcdef')
    render(<Card />)
    act(() => openNewsWindow())
    await screen.findByText('Notes of v2.2.3.')
    expect(cards()).toEqual(['2.2.3-4-gabcdef', '2.2.3'])
    expect(screen.getByRole('dialog', { name: 'New since 2.2.3' })).toBeTruthy()
    expect(card('2.2.3-4-gabcdef').querySelector('[data-change="release-cards"]')).not.toBeNull()
  })
})

describe('the changes', () => {
  it('dim what was seen', async () => {
    act(() => markSeen(['navigation']))
    await openWindow()
    expect(line('navigation').hasAttribute('data-seen')).toBe(true)
    expect(line('run-strip').hasAttribute('data-seen')).toBe(false)
  })

  it('are all marked as seen with one toggle and brought back with the same one', async () => {
    await openWindow()
    fireEvent.click(screen.getByRole('button', { name: `Mark all as seen · ${all}` }))
    expect(document.querySelectorAll('[data-change][data-seen]')).toHaveLength(all)
    fireEvent.click(screen.getByRole('button', { name: `Show all again · ${all}` }))
    expect(document.querySelectorAll('[data-change][data-seen]')).toHaveLength(0)
  })

  it('close the window on the way to the page of a change', async () => {
    await openWindow()
    fireEvent.click(within(line('job-page')).getByRole('button', { name: 'Go there' }))
    expect(window.location.pathname).toBe('/jobs')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('count as seen once the window that listed them closes, when no page draws them', async () => {
    await openWindow()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    const seen: string[] = JSON.parse(localStorage.getItem(KEY)!).seen
    expect(seen.sort()).toEqual(unplaced.map((c) => c.id).sort())
  })

  it('leave a link to anything but the web as text', async () => {
    engineAnswers([{ version: 'v2.3.0', body: 'A paragraph with [a link](javascript:alert(1)).' }])
    render(<Card />)
    act(() => openNewsWindow())
    await screen.findByText(/a link/)
    expect(screen.queryByRole('link', { name: 'a link' })).toBeNull()
  })
})
