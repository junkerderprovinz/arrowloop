// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { storageKey } from '../lib/storage'
import { Dialog } from './Dialog'

afterEach(cleanup)

function open(onClose = () => undefined) {
  render(
    <>
      <button type="button">Behind</button>
      <Dialog title="Edit" onClose={onClose}>
        <input aria-label="Name" />
        <button type="button" disabled>
          Off
        </button>
        <div inert>
          <button type="button">Locked</button>
        </div>
      </Dialog>
    </>,
  )
}

const tab = (shiftKey = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey })

describe('a window', () => {
  it('takes Tab from its last control back round to its first', () => {
    open()
    const close = screen.getByRole('button', { name: 'Close' })
    close.focus()
    tab()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }))
  })

  it('takes Shift+Tab from its first control round to its last, past disabled and inert ones', () => {
    open()
    screen.getByRole('textbox', { name: 'Name' }).focus()
    tab(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })

  it('pulls a focus that got out back in', () => {
    open()
    screen.getByRole('button', { name: 'Behind', hidden: true }).focus()
    tab()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }))
  })

  it('closes on Escape and hands the focus back to its opener', () => {
    const behind = document.createElement('button')
    document.body.append(behind)
    behind.focus()
    const onClose = vi.fn()
    const { unmount } = render(
      <Dialog title="Edit" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    unmount()
    expect(document.activeElement).toBe(behind)
    behind.remove()
  })
})

describe('a window that can be resized', () => {
  afterEach(() => localStorage.clear())

  it('opens at the size it was last dragged to', () => {
    localStorage.setItem(storageKey('dialog-run'), JSON.stringify({ w: 900, h: 640 }))
    render(
      <Dialog title="Run" sizeKey="run" onClose={() => undefined}>
        <p>Lines</p>
      </Dialog>,
    )
    const card = screen.getByRole('dialog', { name: 'Run' })
    expect(card.style.width).toBe('900px')
    expect(card.style.height).toBe('640px')
  })

  it('keeps the size it is dragged to for the next window of its kind', () => {
    render(
      <Dialog title="Run" sizeKey="run" onClose={() => undefined}>
        <p>Lines</p>
      </Dialog>,
    )
    const card = screen.getByRole('dialog', { name: 'Run' })
    card.getBoundingClientRect = () => ({ width: 600, height: 400 }) as DOMRect
    const grip = screen.getByTestId('dialog-grip')
    fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(grip, { clientX: 150, clientY: 130, pointerId: 1 })
    fireEvent.pointerUp(grip, { clientX: 150, clientY: 130, pointerId: 1 })
    expect(JSON.parse(localStorage.getItem(storageKey('dialog-run')) ?? 'null')).toEqual({ w: 700, h: 460 })
  })
})
