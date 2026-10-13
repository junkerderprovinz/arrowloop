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

describe('a selector at the end of a settings row', () => {
  const three = [
    { value: 'both', label: 'Both ways' },
    { value: 'right', label: 'Only to the right' },
    { value: 'left', label: 'Only to the left' },
  ]
  const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!

  // jsdom lays nothing out, so the row's room and each segment's one-line
  // width are given here.
  function layout(room: number, segment: number) {
    Object.defineProperty(Element.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.room ? Number(this.dataset.room) : 0
      },
    })
    const real = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const style = real(el, pseudo)
      if (!el.hasAttribute('data-segment')) return style
      return new Proxy(style, {
        get: (target, key) => {
          if (key === 'width') return `${segment}px`
          const value: unknown = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    })
    render(
      <div data-room={room}>
        <Selector scale="small" hug value="both" options={three} onChange={() => {}} label="Direction" />
      </div>,
    )
  }

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(Element.prototype, 'clientWidth', clientWidth)
  })

  it('is as wide as its segments while they fit', () => {
    layout(500, 120)
    const strip = screen.getByRole('tablist').className.split(' ')
    expect(strip).toContain('w-fit')
    expect(strip).not.toContain('w-full')
    expect(screen.getByRole('tab', { name: 'Both ways' }).style.minWidth).not.toBe('120px')
  })

  it('wraps into even rows as wide as its widest segment once they do not fit', () => {
    layout(300, 120)
    const segment = screen.getByRole('tab', { name: 'Both ways' })
    expect(segment.style.minWidth).toBe('120px')
    expect(segment.style.flex).toContain('0.5*(100% - 6.4px)')
  })
})
