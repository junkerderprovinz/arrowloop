// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Selector } from './Selector'

// jsdom has no ResizeObserver, which the strip uses to measure its room.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

const options = [
  { value: 'sync', label: 'Copy only', hint: 'Nothing is ever removed.' },
  { value: 'mirror', label: 'Mirror', hint: 'The other side becomes an exact copy.' },
]

afterEach(cleanup)

describe('an option with its own explanation', () => {
  it('opens the explanation without choosing the option', () => {
    const onChange = vi.fn()
    render(<Selector scale="small" value="sync" options={options} onChange={onChange} label="Mode" />)
    const info = screen.getByLabelText('The other side becomes an exact copy.')
    fireEvent.click(info)
    fireEvent.keyDown(info, { key: 'Enter' })
    fireEvent.keyDown(info, { key: ' ' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('still chooses the option from the rest of its segment', () => {
    const onChange = vi.fn()
    render(<Selector scale="small" value="sync" options={options} onChange={onChange} label="Mode" />)
    fireEvent.click(screen.getByText('Mirror'))
    expect(onChange).toHaveBeenCalledWith('mirror')
  })
})
