// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { BottomBar } from './BottomBar'

const counts = { running: 0, conflicts: 3, trash: 0, findings: 0 }
const none = { targets: false, anomalies: false }

afterEach(cleanup)

describe('the bottom bar', () => {
  it('holds four places and More', () => {
    render(<BottomBar pins={none} counts={counts} pathname="/jobs" signOut={false} />)
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
    render(<BottomBar pins={none} counts={counts} pathname="/jobs" signOut />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const sheet = screen.getByRole('dialog', { name: 'More' })
    expect(within(sheet).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/trash',
      '/targets',
      '/anomalies',
    ])
    expect(within(sheet).getByRole('button', { name: 'Log out' })).toBeTruthy()
  })

  it('fills More while one of its pages is open', () => {
    render(<BottomBar pins={none} counts={counts} pathname="/trash" signOut={false} />)
    expect(screen.getByRole('button', { name: 'More' }).getAttribute('aria-current')).toBe('true')
  })
})
