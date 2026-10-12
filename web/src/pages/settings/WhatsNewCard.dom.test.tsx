// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RELEASES } from '../../lib/whatsNew'
import { markSeen, startWhatsNew } from '../../lib/whatsNewStore'
import { WhatsNewCard } from './WhatsNewCard'

const all = RELEASES[0].changes.length

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/settings/info')
  startWhatsNew('dev', true)
})
afterEach(cleanup)

const left = () => screen.getByTestId('new-left').textContent

describe('the list of what is new', () => {
  it('counts only the changes nobody has clicked away', () => {
    render(<WhatsNewCard />)
    expect(left()).toBe(`New (${all})`)
    act(() => markSeen(['navigation']))
    expect(left()).toBe(`New (${all - 1})`)
    expect(document.querySelector('[data-change="navigation"]')?.hasAttribute('data-seen')).toBe(true)
  })

  it('settles every change at once and brings them all back', () => {
    render(<WhatsNewCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as seen' }))
    expect(left()).toBe('New (0)')
    fireEvent.click(screen.getByRole('button', { name: 'Show all again' }))
    expect(left()).toBe(`New (${all})`)
  })

  it('goes to the page of a change', () => {
    render(<WhatsNewCard />)
    const row = document.querySelector('[data-change="job-page"]')!
    fireEvent.click(row.querySelector('button')!)
    expect(window.location.pathname).toBe('/jobs')
  })

  it('switches the dots off', () => {
    render(<WhatsNewCard />)
    fireEvent.click(screen.getByRole('switch', { name: 'Show the glowing dots' }))
    expect(JSON.parse(localStorage.getItem('arrowloop.whatsNew')!).dots).toBe(false)
  })
})
