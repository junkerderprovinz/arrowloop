// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RELEASES } from '../../lib/whatsNew'
import { markSeen, startWhatsNew } from '../../lib/whatsNewStore'
import { WhatsNewButton } from './WhatsNew'

const all = RELEASES[0].changes.length

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/settings/info')
  startWhatsNew('dev', true)
})
afterEach(cleanup)

const open = () => fireEvent.click(screen.getByRole('button', { name: /^New/ }))

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

  it('opens the list of changes in a window', () => {
    render(<WhatsNewButton />)
    open()
    const window = screen.getByRole('dialog', { name: "What's new" })
    expect(window.querySelectorAll('[data-change]')).toHaveLength(all)
  })
})

describe('the list of what is new', () => {
  it('dims what was seen', () => {
    act(() => markSeen(['navigation']))
    render(<WhatsNewButton />)
    open()
    expect(document.querySelector('[data-change="navigation"]')?.hasAttribute('data-seen')).toBe(true)
  })

  it('marks everything as seen with one button and brings it all back with the same one', () => {
    render(<WhatsNewButton />)
    open()
    fireEvent.click(screen.getByRole('button', { name: `Mark all as seen · ${all}` }))
    expect(document.querySelectorAll('[data-change][data-seen]')).toHaveLength(all)
    fireEvent.click(screen.getByRole('button', { name: `Show all again · ${all}` }))
    expect(document.querySelectorAll('[data-change][data-seen]')).toHaveLength(0)
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('closes on its way to the page of a change', () => {
    render(<WhatsNewButton />)
    open()
    const row = document.querySelector('[data-change="job-page"]')!
    fireEvent.click(row.querySelector('button')!)
    expect(window.location.pathname).toBe('/jobs')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
