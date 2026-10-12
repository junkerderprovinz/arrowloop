// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { REST_MS, useRevealOnScrollUp } from './revealOnScrollUp'

function Probe() {
  const { revealed } = useRevealOnScrollUp('look', false)
  return <p>{revealed ? 'shown' : 'hidden'}</p>
}

let now = 0
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mount() {
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  render(
    <div data-settings-content>
      <Probe />
    </div>,
  )
}

const column = () => document.querySelector('[data-settings-content]')!

describe('the settings search bar', () => {
  it('waits until the page has rested at its top before a push upward shows it', () => {
    mount()
    act(() => {
      fireEvent.wheel(column(), { deltaY: -40 })
    })
    expect(screen.getByText('hidden')).toBeTruthy()

    now += REST_MS
    act(() => {
      fireEvent.wheel(column(), { deltaY: -40 })
    })
    expect(screen.getByText('shown')).toBeTruthy()
  })

  it('goes away on a push downward', () => {
    mount()
    now += REST_MS
    act(() => {
      fireEvent.wheel(column(), { deltaY: -40 })
    })
    act(() => {
      fireEvent.wheel(column(), { deltaY: 40 })
    })
    expect(screen.getByText('hidden')).toBeTruthy()
  })
})
