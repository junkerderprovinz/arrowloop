// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmWindow } from './ConfirmWindow'
import { Dialog } from './Dialog'
import { InheritButton } from './Inherited'

afterEach(cleanup)

function Asking({ onCancel = () => undefined, onConfirm = () => undefined }) {
  const [asking, setAsking] = useState(false)
  return (
    <div style={{ transform: 'translateY(0)' }} data-testid="card">
      <button type="button" onClick={() => setAsking(true)}>
        Remove
      </button>
      {asking && (
        <ConfirmWindow
          title="Remove"
          message="Remove it?"
          confirmLabel="Remove it"
          cancelLabel="Cancel"
          onCancel={() => {
            setAsking(false)
            onCancel()
          }}
          onConfirm={onConfirm}
        />
      )}
    </div>
  )
}

describe('a confirmation', () => {
  it('stands in the body, outside the card it was asked from', () => {
    render(<Asking />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const dialog = screen.getByRole('dialog')
    expect(screen.getByTestId('card').contains(dialog)).toBe(false)
  })

  it('answers Cancel to Escape and hands the focus back to the button that asked', () => {
    const onCancel = vi.fn()
    render(<Asking onCancel={onCancel} />)
    const remove = screen.getByRole('button', { name: 'Remove' })
    remove.focus()
    fireEvent.click(remove)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(remove)
  })

  it('keeps Tab between its own buttons', () => {
    render(<Asking />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const confirm = screen.getByRole('button', { name: 'Remove it' })
    confirm.focus()
    fireEvent.keyDown(confirm, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirm)
  })

  it('asked from inside a window, closes alone on Escape', () => {
    const closeWindow = vi.fn()
    const onInherit = vi.fn()
    render(
      <Dialog title="Edit" onClose={closeWindow}>
        <InheritButton setting="direction" own defaults={undefined} onOverride={() => undefined} onInherit={onInherit} />
      </Dialog>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Use the default' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(closeWindow).not.toHaveBeenCalled()
    expect(onInherit).not.toHaveBeenCalled()
  })
})
