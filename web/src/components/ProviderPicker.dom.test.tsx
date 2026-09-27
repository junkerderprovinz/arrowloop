// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Provider } from '../lib/api'
import { ProviderPicker } from './ProviderPicker'

// jsdom has no ResizeObserver, which the button uses to fit its name.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

const providers: Provider[] = [
  { id: 'mega', name: 'MEGA', backend: 'mega', group: 'cloud', mark: 'IconMega' },
  { id: 'dropbox', name: 'Dropbox', backend: 'dropbox', group: 'cloud', mark: 'IconDropbox' },
  { id: 'hidrive', name: 'IONOS HiDrive', backend: 'hidrive', group: 'cloud', mark: 'IconIonos' },
  { id: 'sftp', name: 'SFTP', backend: 'sftp', group: 'protocol', mark: 'IconServer' },
]

const here = dirname(fileURLToPath(import.meta.url))
const styles = readFileSync(join(here, '..', 'index.css'), 'utf8')

afterEach(cleanup)

function pick() {
  const onPick = vi.fn()
  render(<ProviderPicker providers={providers} unlisted={[]} onPick={onPick} />)
  return onPick
}

describe('the provider picker', () => {
  it('shows one README button per provider, by name and in order', () => {
    pick()
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(['Dropbox', 'IONOS HiDrive', 'MEGA', 'SFTP'])
    for (const button of screen.getAllByRole('button')) {
      expect(button.classList).toContain('glim-readme-btn')
      expect(button.querySelector('.glim-readme-btn-mark svg')).not.toBeNull()
    }
  })

  it('picks the provider whose button is pressed', () => {
    const onPick = pick()
    fireEvent.click(screen.getByRole('button', { name: 'MEGA' }))
    expect(onPick).toHaveBeenCalledWith(providers[0])
  })

  it('hands a brand its own colour and ink, and leaves a protocol on the accent', () => {
    pick()
    const item = (name: string) => screen.getByRole('button', { name }).closest('li')!
    expect(item('Dropbox').style.getPropertyValue('--provider-tile')).toBe('#0061ff')
    expect(item('Dropbox').style.getPropertyValue('--provider-ink')).toBe('#ffffff')
    expect(item('SFTP').style.getPropertyValue('--provider-tile')).toBe('')
    expect(styles).toContain('--tile: var(--provider-tile, var(--accent));')
  })

  it('lights the button keyboard focus reaches', () => {
    pick()
    const button = screen.getByRole('button', { name: 'Dropbox' })
    button.focus()
    expect(document.activeElement).toBe(button)
    expect(button.classList).toContain('glim-brand-tile')
    const rule = styles.slice(styles.indexOf('.glim-brand-tile:focus-visible,'))
    expect(rule.slice(0, rule.indexOf('}'))).toContain('background-color: var(--tile);')
  })

  // A colour class on the glyph itself would outrank the lit ink on its box.
  it('lets a protocol glyph take the ink of a lit button', () => {
    pick()
    const glyph = screen.getByRole('button', { name: 'SFTP' }).querySelector('.glim-readme-btn-mark svg')!
    expect(glyph.getAttribute('class')).not.toMatch(/text-carbon/)
    expect(glyph.getAttribute('fill')).toBe('currentColor')
  })

  it('explains a protocol in a bubble and a cloud in a tooltip', () => {
    pick()
    const item = (name: string) => screen.getByRole('button', { name }).closest('li')!
    expect(item('SFTP').querySelector('.glim-readme-btn-hint')).not.toBeNull()
    expect(item('SFTP').title).toBe('')
    expect(item('IONOS HiDrive').querySelector('.glim-readme-btn-hint')).toBeNull()
    expect(item('IONOS HiDrive').title).toBe('The cloud storage from IONOS.')
  })
})
