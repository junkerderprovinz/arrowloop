// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Sidebar } from './Sidebar'

const counts = { running: 2, conflicts: 0, trash: 5, findings: 1 }
const extras = { targets: false, anomalies: true }

afterEach(cleanup)

function show(signOut: boolean, pathname = '/jobs') {
  render(<Sidebar extras={extras} counts={counts} pathname={pathname} mode="textGlyph" signOut={signOut} />)
}

describe('the rail', () => {
  it('offers to sign out only where a password is set, just above Settings', () => {
    show(false)
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull()
    cleanup()

    show(true)
    const out = screen.getByRole('button', { name: 'Log out' })
    const settings = screen.getByRole('link', { name: 'Settings' })
    expect(out.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(out.parentElement).toBe(settings.parentElement)
  })

  it('shows a count beside its entry and leaves a zero out', () => {
    show(false)
    expect(within(screen.getByRole('link', { name: /Jobs/ })).getByText('2')).toBeTruthy()
    expect(within(screen.getByRole('link', { name: /Trash/ })).getByText('5')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Conflicts' }).textContent).toBe('Conflicts')
  })

  it('marks the place a page below it belongs to', () => {
    show(false, '/jobs/photos')
    expect(screen.getByRole('link', { name: /Jobs/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBeNull()
  })

  it('holds Anomalies while its notes are on, and leaves unpinned Targets to its tab', () => {
    show(false)
    expect(screen.getByRole('link', { name: /Anomalies/ })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Targets' })).toBeNull()
  })

  it('leaves Anomalies out while its notes are off', () => {
    render(<Sidebar extras={{ targets: false, anomalies: false }} counts={counts} pathname="/jobs" mode="textGlyph" signOut={false} />)
    expect(screen.queryByRole('link', { name: /Anomalies/ })).toBeNull()
  })
})
