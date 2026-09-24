// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { storedLook, storedSlots, storeSlots } from '../lib/look'
import { AccentSwatches } from './Swatches'

const presets = [
  { name: 'Sunflower', hex: '#FCC419' },
  { name: 'Blue', hex: '#1D99F3' },
  { name: 'Green', hex: '#6FDC8C' },
]

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('the accent swatches', () => {
  it('keep an edited colour after another swatch is chosen', () => {
    const onChange = vi.fn()
    const slots = ['#FCC419', '#123456', '#6FDC8C']
    render(
      <AccentSwatches presets={presets} slots={slots} value="#6FDC8C" onChange={onChange} onSlots={vi.fn()} />,
    )
    const edited = screen.getByRole('button', { name: '#123456' })
    expect(edited.style.background).toBe('rgb(18, 52, 86)')
    expect(screen.getByRole('button', { name: 'Green' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(edited.parentElement as HTMLElement)
    expect(onChange).toHaveBeenLastCalledWith('#123456')
  })

  it('give a colour no swatch holds to the nearest one', () => {
    render(
      <AccentSwatches
        presets={presets}
        slots={presets.map((p) => p.hex)}
        value="#1E9AF0"
        onChange={vi.fn()}
        onSlots={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Blue' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('the stored look', () => {
  it('survives a reload', () => {
    localStorage.setItem('glim-appearance', JSON.stringify({ shape: 'square', accent: '#123456' }))
    expect(storedLook()).toEqual({ shape: 'square', accent: '#123456' })
  })

  it('keeps each swatch colour and falls back to the preset for anything unreadable', () => {
    storeSlots(['#123456', 'not a colour'])
    expect(storedSlots(presets.map((p) => p.hex))).toEqual(['#123456', '#1D99F3', '#6FDC8C'])
  })
})
