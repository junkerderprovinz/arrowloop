// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Choice } from './Field'

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
]

afterEach(cleanup)

describe('a closed dropdown', () => {
  it('steps on the wheel while it has focus', () => {
    const onChange = vi.fn()
    render(<Choice value="a" options={options} onChange={onChange} label="Pick" />)
    const trigger = screen.getByRole('button', { name: 'Pick' })
    trigger.focus()
    fireEvent.wheel(trigger, { deltaY: 100 })
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('lets the page scroll past it without focus', () => {
    const onChange = vi.fn()
    render(<Choice value="a" options={options} onChange={onChange} label="Pick" />)
    const trigger = screen.getByRole('button', { name: 'Pick' })
    const passed = fireEvent.wheel(trigger, { deltaY: 100 })
    expect(onChange).not.toHaveBeenCalled()
    expect(passed).toBe(true)
  })
})
