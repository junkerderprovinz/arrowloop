// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { en } from '../lib/i18n.data'
import { Link } from '../lib/router'
import { markSeen, startWhatsNew, useWhatsNew } from '../lib/whatsNewStore'
import { WhatsNewDots } from './WhatsNewDots'

// jsdom lays nothing out, so every element is given a box of its own.
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(() => [{}] as unknown as DOMRectList)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }) as DOMRect,
  )
  localStorage.clear()
  window.history.replaceState(null, '', '/jobs')
  startWhatsNew('dev', true)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Page({ active = true }: { active?: boolean }) {
  const news = useWhatsNew()
  return (
    <>
      <aside data-nav-rail data-new="navigation">
        <Link to="/jobs">Jobs</Link>
        <Link to="/settings">Settings</Link>
      </aside>
      <main />
      <WhatsNewDots news={news} active={active} />
    </>
  )
}

const dot = (id: string) => document.querySelector<HTMLButtonElement>(`[data-new-dot="${id}"]`)

describe('the dots of what is new', () => {
  it('mark a changed element and hide it for good once clicked', async () => {
    render(<Page />)
    await waitFor(() => expect(dot('navigation')).not.toBeNull())
    act(() => dot('navigation')!.click())
    await waitFor(() => expect(dot('navigation')).toBeNull())
    expect(JSON.parse(localStorage.getItem('arrowloop.whatsNew')!).seen).toContain('navigation')
  })

  it('put one dot on the link that leads to the changes behind it', async () => {
    render(<Page />)
    const way = await waitFor(() => {
      const found = dot('way')
      expect(found).not.toBeNull()
      return found!
    })
    expect(way.getAttribute('aria-label')).toMatch(/^New this way \(11\):/)
    fireEvent.click(way)
    expect(window.location.pathname).toBe('/settings')
  })

  it('take the dot off a link once everything behind it was seen', async () => {
    render(<Page />)
    await waitFor(() => expect(dot('way')).not.toBeNull())
    act(() => markSeen(['settings-tiles', 'settings-search', 'anomalies-module', 'info-tile', 'login-reset', 'provider-names', 'target-rows', 'notify-channels', 'tile-order', 'schedule-sentence', 'exceptions']))
    await waitFor(() => expect(dot('way')).toBeNull())
  })

  it('mark the page once for every change it does not draw, and name them all', async () => {
    render(<Page />)
    const page = await waitFor(
      () => {
        const found = dot('page')
        expect(found).not.toBeNull()
        return found!
      },
      { timeout: 3000 },
    )
    const others = Array.from(document.querySelectorAll('[data-new-dot]')).filter((d) => !['page', 'way', 'navigation'].includes(d.getAttribute('data-new-dot')!))
    expect(others).toHaveLength(0)
    for (const key of ['new.change.runStrip'] as const) {
      expect(page.getAttribute('aria-label')).toContain(en[key])
    }
    act(() => page.click())
    await waitFor(() => expect(dot('page')).toBeNull())
    expect(JSON.parse(localStorage.getItem('arrowloop.whatsNew')!).seen).toEqual(expect.arrayContaining(['run-strip']))
  })

  it('draw nothing during the first start', async () => {
    render(<Page active={false} />)
    await new Promise((done) => setTimeout(done, 50))
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
