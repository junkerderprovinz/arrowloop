// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Backend, Provider } from '../lib/api'
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
const tokens = readFileSync(join(here, '..', 'tokens.css'), 'utf8')

afterEach(cleanup)

function pick(list = providers, unlisted: Backend[] = []) {
  const onPick = vi.fn()
  render(<ProviderPicker providers={list} unlisted={unlisted} onPick={onPick} onClose={vi.fn()} />)
  return onPick
}

const tiles = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.glim-provider-pick button.glim-readme-btn'))
const tile = (name: string) => within(screen.getByRole('dialog')).getByRole('button', { name })

describe('the provider picker', () => {
  it("points What's new at the rows whose mark changed", () => {
    pick([
      ...providers,
      { id: 'synologyc2', name: 'Synology C2', backend: 's3', group: 'storage', mark: 'IconSynology' },
      { id: 'filefabric', name: 'Enterprise File Fabric', backend: 'filefabric', group: 'cloud', mark: 'IconTabStorage' },
    ])
    const marked = Array.from(document.querySelectorAll('[data-new="provider-marks"]')).map((el) =>
      el.closest('button')?.getAttribute('aria-label'),
    )
    expect(marked.sort()).toEqual(['Enterprise File Fabric', 'Synology C2'])
  })

  it('shows one README button per provider, by name and in order', () => {
    pick()
    expect(tiles().map((b) => b.getAttribute('aria-label'))).toEqual(['Dropbox', 'IONOS HiDrive', 'MEGA', 'SFTP'])
    for (const button of tiles()) {
      expect(button.querySelector('.glim-readme-btn-mark svg')).not.toBeNull()
    }
  })

  it('stands the groups in their order under their titles', () => {
    pick()
    const sections = Array.from(document.querySelectorAll('section')).map((s) => s.querySelector('h3')?.textContent)
    expect(sections).toEqual(['Clouds', 'Servers & shares'])
  })

  it('picks the provider whose button is pressed', () => {
    const onPick = pick()
    fireEvent.click(tile('MEGA'))
    expect(onPick).toHaveBeenCalledWith(providers[0])
  })

  it('offers the backends no provider covers last, by their rclone names', () => {
    const onPick = pick(providers, [{ name: 'newfs', description: '', options: [] }])
    const sections = Array.from(document.querySelectorAll('section'))
    expect(sections.at(-1)?.querySelector('h3')?.textContent).toBe('1 more, by their rclone name')
    expect(tiles().at(-1)?.getAttribute('aria-label')).toBe('newfs')
    fireEvent.click(tile('newfs'))
    expect(onPick).toHaveBeenCalledWith('newfs')
  })

  it('hands a brand its own colour and ink, and leaves a protocol on the accent', () => {
    pick()
    const item = (name: string) => tile(name).closest('li')!
    expect(item('Dropbox').style.getPropertyValue('--provider-tile')).toBe('#0061ff')
    expect(item('Dropbox').style.getPropertyValue('--provider-ink')).toBe('#ffffff')
    expect(item('SFTP').style.getPropertyValue('--provider-tile')).toBe('')
    expect(tokens).toContain('--tile: var(--provider-tile, var(--accent));')
  })

  it('lights the button keyboard focus reaches', () => {
    pick()
    const button = tile('Dropbox')
    button.focus()
    expect(document.activeElement).toBe(button)
    expect(button.classList).toContain('glim-brand-tile')
    const rule = styles.slice(styles.indexOf('.glim-brand-tile:focus-visible,'))
    expect(rule.slice(0, rule.indexOf('}'))).toContain('background-color: var(--tile);')
  })

  // A colour class on the glyph itself would outrank the lit ink on its box.
  it('lets a protocol glyph take the ink of a lit button', () => {
    pick()
    const glyph = tile('SFTP').querySelector('.glim-readme-btn-mark svg')!
    expect(glyph.getAttribute('class')).not.toMatch(/text-carbon/)
    expect(glyph.getAttribute('fill')).toBe('currentColor')
  })

  it('explains in a bubble what a name cannot say, and leaves a plain name alone', () => {
    pick()
    const item = (name: string) => tile(name).closest('li')!
    expect(item('SFTP').querySelector('.glim-readme-btn-hint')).not.toBeNull()
    expect(item('IONOS HiDrive').querySelector('.glim-readme-btn-hint')).not.toBeNull()
    expect(item('Dropbox').querySelector('.glim-readme-btn-hint')).toBeNull()
  })

  it('shows the form in place of the tiles, with Back before its actions', () => {
    const onBack = vi.fn()
    render(
      <ProviderPicker
        providers={providers}
        unlisted={[]}
        onPick={vi.fn()}
        form={<p>The form</p>}
        actions={[{ label: 'Save', labelKey: 'targets.save', primary: true, onClick: () => false }]}
        onBack={onBack}
        onClose={vi.fn()}
      />,
    )
    const dialog = screen.getByRole('dialog')
    expect(tiles()).toEqual([])
    expect(within(dialog).getByText('The form')).toBeTruthy()
    const foot = Array.from(dialog.querySelectorAll('.glim-modal-foot button')).map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(foot.indexOf('Back')).toBeLessThan(foot.indexOf('Save'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
  })
})
