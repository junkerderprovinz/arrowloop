// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BottomBar } from './BottomBar'

const counts = { running: 0, conflicts: 3, trash: 0, findings: 0 }
const extras = { targets: false, anomalies: true }

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the bottom bar', () => {
  it('holds four places and More', () => {
    render(<BottomBar extras={extras} counts={counts} pathname="/jobs" signOut={false} />)
    const bar = screen.getByRole('navigation')
    expect(within(bar).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/jobs',
      '/conflicts',
      '/history',
      '/settings',
    ])
    expect(within(bar).getByRole('button', { name: 'More' })).toBeTruthy()
  })

  it('opens the rest in a sheet, sign out last where a password is set', () => {
    render(<BottomBar extras={extras} counts={counts} pathname="/jobs" signOut />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const sheet = screen.getByRole('dialog', { name: 'More' })
    expect(within(sheet).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/anomalies',
      '/trash',
      '/targets',
    ])
    expect(within(sheet).getByRole('button', { name: 'Log out' })).toBeTruthy()
  })

  it('leaves the focus where it is in the sheet when the bar draws again, and Escape takes it back to More', () => {
    const { rerender } = render(<BottomBar extras={extras} counts={counts} pathname="/jobs" signOut={false} />)
    const more = screen.getByRole('button', { name: 'More' })
    fireEvent.click(more)
    const sheet = screen.getByRole('dialog', { name: 'More' })
    expect(document.activeElement).toBe(within(sheet).getByRole('button', { name: 'Close' }))
    const trash = within(sheet).getByRole('link', { name: 'Trash' })
    trash.focus()
    rerender(<BottomBar extras={extras} counts={{ ...counts, trash: 2 }} pathname="/jobs" signOut={false} />)
    expect(document.activeElement).toBe(trash)
    fireEvent.keyDown(trash, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(more)
  })

  it('shrinks a word that would be cut rather than cutting it, as far as the phone does', () => {
    // jsdom lays nothing out: every word is 90px wide in a 66px slot.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(66)
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.style.fontSize ? 66 : 90
    })
    render(<BottomBar extras={extras} counts={counts} pathname="/jobs" signOut={false} />)
    const word = within(screen.getByRole('navigation')).getByText('Settings')
    expect(word.style.fontSize).toBe('calc(var(--text-meta) * 0.733)')
  })

  it('fills More while one of its pages is open', () => {
    render(<BottomBar extras={extras} counts={counts} pathname="/trash" signOut={false} />)
    expect(screen.getByRole('button', { name: 'More' }).getAttribute('aria-current')).toBe('true')
  })
})
