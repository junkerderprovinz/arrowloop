// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { Dialog } from './Dialog'
import { Menu } from './Menu'

afterEach(cleanup)

function Page() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Menu label="More" labelKey="list.more" items={[{ label: 'Remove', labelKey: 'edit.remove', onSelect: () => setOpen(true) }]} />
      {open && (
        <Dialog title="Remove" onClose={() => setOpen(false)}>
          <p>Gone for good.</p>
        </Dialog>
      )}
    </>
  )
}

describe('a menu', () => {
  it('hands the focus back to its button once a window opened from it closes', () => {
    render(<Page />)
    const more = screen.getByRole('button', { name: 'More' })
    more.focus()
    fireEvent.click(more)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(more)
  })
})
