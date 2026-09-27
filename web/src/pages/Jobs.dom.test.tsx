// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Job } from '../lib/api'

const LEFT = 'C:\\Users\\somebody\\Pictures\\Camera Roll\\2024\\Holidays in the mountains\\Day three'
const RIGHT = 'nextcloud:Photos/Archive/2024/Holidays in the mountains/Day three/Originals'

vi.mock('../lib/api', () => ({
  api: {
    config: () => Promise.resolve({ jobs: [{ name: 'photos', left: LEFT, right: RIGHT, state: 'state/photos.db' }] }),
    settings: () => Promise.resolve({}),
    volumes: () => Promise.resolve({ volumes: [] }),
    remotes: () => Promise.resolve({ remotes: [], backends: [] }),
    run: vi.fn(),
    stopJob: vi.fn(),
  },
}))

const { Jobs } = await import('./Jobs')

function job(over: Partial<Job> = {}): Job {
  return {
    name: 'photos',
    left: LEFT,
    right: RIGHT,
    direction: 'both',
    schedule: '',
    watch: false,
    disabled: false,
    running: false,
    lastSuccess: null,
    ...over,
  }
}

function card(over: Partial<Job> = {}) {
  render(<Jobs jobs={[job(over)]} runs={[]} progress={{}} onPreview={() => undefined} onSaved={() => undefined} />)
}

afterEach(cleanup)

describe('a job card', () => {
  it('shows both sides whole', () => {
    card()
    const left = screen.getByText(LEFT)
    const right = screen.getByText(RIGHT)
    for (const side of [left, right]) {
      expect(side.className).not.toMatch(/truncate/)
      expect(side.className).toMatch(/overflow-wrap:anywhere/)
    }
  })

  it('has exactly pause, run and options once the job is known', async () => {
    card()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy())
    const row = screen.getByRole('button', { name: 'Pause' }).parentElement as HTMLElement
    const names = within(row)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim())
    expect(names).toEqual(['Pause', 'Run now', 'Options'])
  })

  it('offers cancel instead of run while the job runs', async () => {
    card({ running: true })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel the run' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull()
  })

  it('keeps everything else in the options menu', async () => {
    card()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Options' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Options' }))
    const menu = await screen.findByRole('menu')
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((b) => b.textContent?.trim())
    expect(items).toEqual(['Activity', 'Edit', 'Duplicate', 'Remove', 'Preview'])
  })

  it('closes the menu on Escape', async () => {
    card()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Options' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Options' }))
    await screen.findByRole('menu')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
