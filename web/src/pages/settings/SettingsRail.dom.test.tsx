// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SettingsRail, stripPerRow } from './SettingsRail'
import { isOwnOrder, orderTiles, settingsTiles } from './tiles'

let narrow = false

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

window.matchMedia = ((query: string) => ({
  get matches() {
    return narrow
  },
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

afterEach(() => {
  cleanup()
  narrow = false
  localStorage.clear()
  document.documentElement.dir = 'ltr'
})

describe('the settings strip', () => {
  it('names the open tile and leaves the others their glyph, with the name for the reader', () => {
    render(<SettingsRail tiles={settingsTiles(true)} active="sync" across />)
    const strip = screen.getByRole('tablist', { name: 'Settings pages' })
    expect(strip.getAttribute('aria-orientation')).toBeNull()
    expect(screen.getAllByRole('tab').map((el) => el.getAttribute('href'))).toEqual([
      '/settings/general',
      '/settings/look',
      '/settings/sync',
      '/settings/safety',
      '/settings/targets',
      '/settings/security',
      '/settings/apps',
      '/settings/info',
    ])
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Sync')
    const look = screen.getByRole('tab', { name: 'Look' })
    expect(look.textContent).toBe('')
    expect(look.getAttribute('data-tip')).toBe('Look')
  })

  it('moves the focus with the arrow keys across, the other way round from right to left', () => {
    render(<SettingsRail tiles={settingsTiles(true)} active="look" across />)
    const [general, look, sync] = screen.getAllByRole('tab')
    look!.focus()
    fireEvent.keyDown(look!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(sync)
    document.documentElement.dir = 'rtl'
    fireEvent.keyDown(sync!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(look)
    fireEvent.keyDown(look!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(general)
  })

  it('moves the focused tile with Alt and an arrow key, in the same order as the column', () => {
    render(<SettingsRail tiles={settingsTiles(true)} active="general" across />)
    const [first] = screen.getAllByRole('tab')
    first!.focus()
    fireEvent.keyDown(first!, { key: 'ArrowRight', altKey: true })
    expect(JSON.parse(localStorage.getItem('arrowloop.settingsOrder') ?? '[]').slice(0, 3)).toEqual(['look', 'general', 'sync'])
  })

  it('shares the tiles evenly between the rows it wraps onto', () => {
    expect(stripPerRow(8, 500, 120, 40, 4)).toBe(8)
    expect(stripPerRow(8, 358, 120, 40, 4)).toBe(4)
    expect(stripPerRow(7, 358, 120, 40, 4)).toBe(4)
    expect(stripPerRow(8, 150, 140, 40, 4)).toBe(1)
  })
})

describe('the settings tiles', () => {
  it('stand in one column, a link to each tile with the open one selected', () => {
    render(<SettingsRail tiles={settingsTiles(true)} active="sync" />)
    const column = screen.getByRole('tablist', { name: 'Settings pages' })
    expect(column.getAttribute('aria-orientation')).toBe('vertical')
    const tiles = screen.getAllByRole('tab')
    expect(tiles.map((el) => el.getAttribute('href'))).toEqual([
      '/settings/general',
      '/settings/look',
      '/settings/sync',
      '/settings/safety',
      '/settings/targets',
      '/settings/security',
      '/settings/apps',
      '/settings/info',
    ])
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Sync')
  })

  it('leave Security out where the build keeps no password', () => {
    render(<SettingsRail tiles={settingsTiles(false)} active="general" />)
    expect(screen.queryByRole('tab', { name: 'Security' })).toBeNull()
  })

  it('take the arrow keys as one tab stop', () => {
    render(<SettingsRail tiles={settingsTiles(true)} active="general" />)
    const [first, second] = screen.getAllByRole('tab')
    expect(screen.getAllByRole('tab').filter((el) => el.tabIndex === 0)).toEqual([first])
    first!.focus()
    fireEvent.keyDown(first!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)
  })

  it('show only their glyphs in a narrow window and keep the name for the reader', () => {
    narrow = true
    render(<SettingsRail tiles={settingsTiles(true)} active="general" />)
    const look = screen.getByRole('tab', { name: 'Look' })
    expect(look.textContent).toBe('')
    expect(look.getAttribute('title')).toBe('Look')
  })

  it('move the focused tile with Alt and an arrow key and keep the order in this browser', () => {
    render(<SettingsRail tiles={settingsTiles(true)} active="general" />)
    const [first] = screen.getAllByRole('tab')
    first!.focus()
    fireEvent.keyDown(first!, { key: 'ArrowDown', altKey: true })
    expect(JSON.parse(localStorage.getItem('arrowloop.settingsOrder') ?? '[]').slice(0, 3)).toEqual(['look', 'general', 'sync'])
    expect(screen.getByText('Moved General to place 2')).toBeTruthy()
  })

  it('keep a long press from opening the context menu after the strip became the column', () => {
    const { rerender } = render(<SettingsRail tiles={settingsTiles(true)} active="look" across />)
    rerender(<SettingsRail tiles={settingsTiles(true)} active="look" />)
    const sync = screen.getByRole('tab', { name: 'Sync' })
    fireEvent.pointerDown(sync, { button: 0, pointerType: 'touch', pointerId: 1 })
    expect(fireEvent.contextMenu(sync)).toBe(false)
  })

  it('take no step past either end of the column', () => {
    render(<SettingsRail tiles={settingsTiles(true)} active="general" />)
    const [first] = screen.getAllByRole('tab')
    fireEvent.keyDown(first!, { key: 'ArrowUp', altKey: true })
    expect(localStorage.getItem('arrowloop.settingsOrder')).toBeNull()
  })
})

describe('the tile order', () => {
  const ids = (saved: string[], security = true) => orderTiles(settingsTiles(security), saved).map((x) => x.id)

  it('puts a tile the stored order does not know after the one before it in the app', () => {
    expect(ids(['info', 'general', 'look', 'sync', 'safety', 'targets', 'apps'])).toEqual([
      'info', 'general', 'look', 'sync', 'safety', 'targets', 'security', 'apps',
    ])
  })

  it('forgets a stored tile this build does not offer', () => {
    expect(ids(['security', 'apps', 'general'], false)).toEqual(['apps', 'info', 'general', 'look', 'sync', 'safety', 'targets'])
  })

  it("counts an order as the app's own when only missing tiles differ", () => {
    expect(isOwnOrder([])).toBe(true)
    expect(isOwnOrder(['general', 'sync', 'info'])).toBe(true)
    expect(isOwnOrder(['sync', 'general'])).toBe(false)
  })
})
