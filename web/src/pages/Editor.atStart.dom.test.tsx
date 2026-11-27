// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RawJob } from '../lib/api'
import { JobForm } from './Editor'

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

afterEach(cleanup)

const base: RawJob = { name: 'camera', left: '/a', right: '/b', state: 'camera.db', schedule: '0 3 * * *' }

function form(job: RawJob) {
  const patch = vi.fn()
  render(<JobForm job={job} known={[]} remotes={[]} patch={patch} follows={false} onHeld={() => {}} />)
  return patch
}

const choices = () => within(screen.getByRole('tablist', { name: 'At program start' }))

describe('what a job does at program start', () => {
  it('waits for its schedule unless it says otherwise', () => {
    form(base)
    expect(choices().getByRole('tab', { name: /^Off/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('reads an older job that runs at every start as Always', () => {
    form({ ...base, runAtStart: true })
    expect(choices().getByRole('tab', { name: /^Always/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('writes When due as due and Always as true', () => {
    const patch = form(base)
    fireEvent.click(choices().getByRole('tab', { name: /^When due/ }))
    expect(patch).toHaveBeenLastCalledWith({ runAtStart: 'due' })
    fireEvent.click(choices().getByRole('tab', { name: /^Always/ }))
    expect(patch).toHaveBeenLastCalledWith({ runAtStart: true })
  })

  it('takes the setting out of the file when switched off', () => {
    const patch = form({ ...base, runAtStart: 'due' })
    fireEvent.click(choices().getByRole('tab', { name: /^Off/ }))
    expect(patch).toHaveBeenLastCalledWith({ runAtStart: undefined })
  })
})
