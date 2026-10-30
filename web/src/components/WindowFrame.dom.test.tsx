// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const own = { frame: true }
const frame = {
  minimise: vi.fn(() => Promise.resolve()),
  toggleMaximise: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  maximised: vi.fn(() => Promise.resolve(false)),
  drag: vi.fn(),
}
const stopResizing = vi.fn()
const resizeFromEdges = vi.fn(() => stopResizing)

vi.mock('../lib/desk', () => ({
  drawsOwnFrame: () => own.frame,
  frame,
  resizeFromEdges,
}))

const { WindowFrame } = await import('./WindowFrame')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  own.frame = true
})

async function show() {
  await act(async () => {
    render(<WindowFrame />)
  })
}

describe('the desktop title bar', () => {
  it('stays away where the window has a title bar of its own', async () => {
    own.frame = false
    await show()
    expect(screen.queryByRole('banner')).toBeNull()
    expect(resizeFromEdges).not.toHaveBeenCalled()
  })

  it('offers minimise, maximise and close in that order, and nothing else', async () => {
    await show()
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(['Minimise', 'Maximise', 'Close'])
    expect(screen.getByRole('banner').getAttribute('aria-label')).toBe('ArrowLoop')
  })

  it('closes through the window, so the shell still chooses between the tray and quitting', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(frame.close).toHaveBeenCalledOnce()
  })

  it('moves the window once a press on the bar starts to move, not on the press', async () => {
    await show()
    const bar = screen.getByRole('banner')
    fireEvent.mouseDown(bar, { button: 0 })
    expect(frame.drag).not.toHaveBeenCalled()
    fireEvent.mouseMove(bar, { buttons: 1 })
    expect(frame.drag).toHaveBeenCalledOnce()
  })

  it('maximises on a double click on the bar', async () => {
    await show()
    fireEvent.doubleClick(screen.getByRole('banner'))
    expect(frame.toggleMaximise).toHaveBeenCalledOnce()
  })

  it('offers Restore and lets go of the edges while the window is maximised', async () => {
    frame.maximised.mockResolvedValueOnce(true)
    await show()
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
    expect(stopResizing).toHaveBeenCalled()
  })
})
