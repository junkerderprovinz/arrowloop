// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
