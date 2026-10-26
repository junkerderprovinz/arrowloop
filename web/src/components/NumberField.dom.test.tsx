// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { NumberField } from './Field'

afterEach(cleanup)

let hide: () => void = () => {}

function Toggled() {
  const [shown, setShown] = useState(true)
  hide = () => setShown(false)
  return <div data-testid="row">{shown ? <NumberField value={30} onChange={() => {}} label="Every" /> : <span>daily</span>}</div>
}

describe('a number field', () => {
  it('wears the steppers inside its own box', () => {
    const { container } = render(<NumberField value={5} onChange={() => {}} label="Every" />)
    expect(container.querySelector('.glim-num-wrap input[type="number"]')).not.toBeNull()
    expect(container.querySelectorAll('.glim-num-step')).toHaveLength(2)
  })

  it('can leave the page while its neighbours stay', () => {
    const { getByTestId } = render(<Toggled />)
    expect(() => act(() => hide())).not.toThrow()
    expect(getByTestId('row').textContent).toBe('daily')
  })
})
