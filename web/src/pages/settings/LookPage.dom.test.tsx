// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RAINBOW, rainbowState } from '../../lib/appearance'
import { LABEL_MODES } from '../../lib/controls'
import { LookPage, PRESET_HEXES, type LookProps } from './LookPage'

// jsdom cannot measure elements, which the selectors ask for.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver
window.matchMedia ??= ((media: string) => ({
  matches: false,
  media,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia

function props(over: Partial<LookProps> = {}): LookProps {
  return {
    theme: 'dark',
    onTheme: vi.fn(),
    shape: 'round',
    onShape: vi.fn(),
    accent: PRESET_HEXES[0]!,
    onAccent: vi.fn(),
    slots: PRESET_HEXES,
    onSlots: vi.fn(),
    rainbow: { ...rainbowState(), palette: [...RAINBOW] },
    onRainbow: vi.fn(),
    disco: false,
    onDisco: vi.fn(),
    motion: 'subtle',
    onMotion: vi.fn(),
    labels: { buttons: LABEL_MODES[1]!, sidebar: LABEL_MODES[1]!, tabs: LABEL_MODES[1]!, bottombar: LABEL_MODES[1]! },
    onLabels: vi.fn(),
    lang: 'en',
    onLang: vi.fn(),
    languages: [{ code: 'en', label: 'English', flag: 'gb' }],
    ...over,
  }
}

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'dark')
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.removeAttribute('data-oled')
  document.documentElement.removeAttribute('data-theme')
})

describe('the OLED switch', () => {
  it('stands right under Design', () => {
    render(<LookPage {...props()} />)
    const labels = [...document.querySelectorAll('[data-glim-label]')].map((el) => el.getAttribute('data-glim-label'))
    expect(labels.indexOf('OLED')).toBe(labels.indexOf('Design') + 1)
  })

  it('puts the page on black and keeps that on this device only', () => {
    render(<LookPage {...props()} />)
    fireEvent.click(screen.getByRole('switch', { name: 'OLED' }))
    expect(document.documentElement.hasAttribute('data-oled')).toBe(true)
    expect(localStorage.getItem('glim-oled')).toBe('1')

    fireEvent.click(screen.getByRole('switch', { name: 'OLED' }))
    expect(document.documentElement.hasAttribute('data-oled')).toBe(false)
    expect(localStorage.getItem('glim-oled')).toBeNull()
  })

  it('starts from what this device chose', () => {
    localStorage.setItem('glim-oled', '1')
    render(<LookPage {...props()} />)
    expect(screen.getByRole('switch', { name: 'OLED' }).getAttribute('aria-checked')).toBe('true')
  })

  it('stays in reach but steps back while the light look shows', async () => {
    render(<LookPage {...props()} />)
    const name = () => document.querySelector('[data-glim-label="OLED"]') as HTMLElement
    expect(name().className).not.toContain('opacity-50')

    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'light')
      await Promise.resolve()
    })
    expect(name().className).toContain('opacity-50')
    expect((screen.getByRole('switch', { name: 'OLED' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('refuses while Light is chosen, keeps its state and says why', () => {
    localStorage.setItem('glim-oled', '1')
    render(<LookPage {...props({ theme: 'light' })} />)
    const oled = screen.getByRole('switch', { name: 'OLED' })
    expect(oled.getAttribute('aria-disabled')).toBe('true')

    fireEvent.click(oled)
    expect(oled.getAttribute('aria-checked')).toBe('true')
    expect(localStorage.getItem('glim-oled')).toBe('1')
    const reason = document.getElementById(oled.getAttribute('aria-describedby')!)
    expect(reason?.textContent).toBe('Only with Dark or System. Light is chosen above.')
  })

  it('flips under System, where the device may turn dark', () => {
    render(<LookPage {...props({ theme: 'system' })} />)
    const oled = screen.getByRole('switch', { name: 'OLED' })
    expect(oled.hasAttribute('aria-disabled')).toBe(false)
    fireEvent.click(oled)
    expect(oled.getAttribute('aria-checked')).toBe('true')
  })
})

describe('the job list choice', () => {
  it('stands on the Look card between Motion and Tile order', () => {
    render(<LookPage {...props()} />)
    const labels = [...document.querySelectorAll('[data-glim-label]')].map((el) => el.getAttribute('data-glim-label'))
    expect(labels.indexOf('Job list')).toBe(labels.indexOf('Motion') + 1)
    expect(labels.indexOf('Tile order')).toBe(labels.indexOf('Job list') + 1)
  })

  it('shows cards until something else is chosen', () => {
    render(<LookPage {...props()} />)
    expect(screen.getByRole('tab', { name: 'Cards' }).getAttribute('aria-selected')).toBe('true')
  })

  it('switches the job list to Compact and keeps that in this browser, where the Jobs page reads it', () => {
    render(<LookPage {...props()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Compact' }))
    expect(screen.getByRole('tab', { name: 'Compact' }).getAttribute('aria-selected')).toBe('true')
    expect(localStorage.getItem('arrowloop.jobs.view')).toBe('"compact"')

    fireEvent.click(screen.getByRole('tab', { name: 'Cards' }))
    expect(localStorage.getItem('arrowloop.jobs.view')).toBe('"cards"')
  })

  it('starts from a choice this browser made before', () => {
    localStorage.setItem('arrowloop.jobs.view', '"compact"')
    render(<LookPage {...props()} />)
    expect(screen.getByRole('tab', { name: 'Compact' }).getAttribute('aria-selected')).toBe('true')
  })
})
