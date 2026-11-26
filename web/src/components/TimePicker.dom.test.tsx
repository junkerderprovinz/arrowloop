// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { TimePicker } from './TimePicker'

afterEach(cleanup)

function Cards() {
  const [time, setTime] = useState('03:00')
  return (
    <>
      <div data-testid="schedule-card" className="glim-panel glim-stagger-row">
        <TimePicker value={time} label="At" onChange={setTime} />
      </div>
      <div data-testid="next-card" className="glim-panel glim-stagger-row">
        <button type="button">Further down</button>
      </div>
    </>
  )
}

function openPicker() {
  render(<Cards />)
  fireEvent.click(screen.getByRole('button', { name: 'At: 03:00' }))
  return screen.getByRole('dialog', { name: 'At' })
}

describe('a time picker', () => {
  it('opens outside its card, so a card further down cannot cover it', () => {
    const panel = openPicker()
    expect(screen.getByTestId('schedule-card').contains(panel)).toBe(false)
    expect(panel.parentElement).toBe(document.body)
  })

  it('stays open while the hour is picked and closes on the minute', () => {
    const panel = openPicker()
    const hour = screen.getAllByRole('option', { name: '07' })[0]
    fireEvent.mouseDown(hour)
    fireEvent.click(hour)
    expect(screen.getByRole('dialog', { name: 'At' })).toBe(panel)
    expect(screen.getByRole('button', { name: 'At: 07:00' })).toBeTruthy()

    const minute = screen.getByRole('option', { name: '30' })
    fireEvent.mouseDown(minute)
    fireEvent.click(minute)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'At: 07:30' })).toBeTruthy()
  })

  it('closes on a press beside it and on Escape', () => {
    openPicker()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Further down' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'At: 03:00' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
