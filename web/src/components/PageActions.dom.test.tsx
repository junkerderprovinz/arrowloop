// @vitest-environment jsdom
// jsdom lays nothing out, so that the corner sticks is pinned by its classes
// and by the rules in index.css that let the page fill the scroller.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NARROW_QUERY } from '../lib/narrow'
import { PageAction, PageActions } from './PageActions'

let narrow = false
window.matchMedia = ((query: string) => ({
  get matches() {
    return query === NARROW_QUERY ? narrow : false
  },
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.css'), 'utf8')

function corner(onAdd = () => {}) {
  render(
    <main>
      <PageActions>
        <PageAction label="Register a drive" labelKey={null} glyph={<svg />} onClick={() => {}} />
        <PageAction primary label="Add" labelKey={null} glyph={<svg />} onClick={onAdd} />
      </PageActions>
    </main>,
  )
  return screen.getByTestId('page-actions')
}

beforeEach(() => {
  narrow = false
})
afterEach(cleanup)

describe('PageActions', () => {
  it('sticks to the bottom of the scroller in the flow of the page, never fixed', () => {
    const bar = corner()
    expect(bar.className).toContain('sticky')
    expect(bar.className).toContain('bottom-0')
    expect(bar.className).not.toMatch(/(^|\s)fixed(\s|$)/)
    expect(css).toMatch(/\.glim-page-enter > :has\(> \.glim-page-actions\)\s*\{\s*flex-grow:\s*1;/)
  })

  it('keeps 96px below the last row for the buttons', () => {
    expect(corner().className).toContain('min-h-24')
  })

  it('fills only the action the page exists for', () => {
    corner()
    expect(screen.getByRole('button', { name: 'Add' }).className).toContain('bg-accent')
    expect(screen.getByRole('button', { name: 'Register a drive' }).className).not.toContain('bg-accent')
  })

  it('runs the action', () => {
    const onAdd = vi.fn()
    corner(onAdd)
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('tells the toasts how far up it reaches, and takes that back when it leaves', () => {
    corner()
    expect(document.documentElement.style.getPropertyValue('--page-actions-clearance')).toMatch(/^\d+px$/)
    cleanup()
    expect(document.documentElement.style.getPropertyValue('--page-actions-clearance')).toBe('')
  })

  it('shows the glyph alone on a phone-narrow window', () => {
    narrow = true
    corner()
    expect(screen.getByRole('button', { name: 'Add' }).className).toContain('glim-glyph-only')
  })
})

describe('a window on a phone-narrow screen', () => {
  it('stands on the bottom edge as a sheet', () => {
    const block = css.slice(css.indexOf('@media (max-width: 639px)'))
    expect(block).toMatch(/\.glim-modal-backdrop\s*\{\s*align-items:\s*flex-end;/)
    expect(block).toMatch(/\.glim-modal-backdrop > \.glim-modal-card\s*\{[^}]*border-end-start-radius:\s*0;/)
  })
})
