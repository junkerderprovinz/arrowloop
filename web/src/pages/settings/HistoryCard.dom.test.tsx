// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Settings } from '../../lib/api'

let stored: Settings = {}
const saveSettings = vi.fn((s: Settings) => {
  stored = { ...stored, ...s }
  return Promise.resolve(stored)
})
const pruneHistory = vi.fn(() => Promise.resolve({ runs: 12 }))
const toast = vi.fn()

vi.mock('../../lib/api', async (actual) => ({
  ...(await actual<typeof import('../../lib/api')>()),
  api: {
    settings: () => Promise.resolve(stored),
    saveSettings: (s: Settings) => saveSettings(s),
    pruneHistory: () => pruneHistory(),
  },
}))
vi.mock('../../lib/toast', () => ({ useToast: () => toast }))

const { HistoryCard } = await import('./HistoryCard')

beforeEach(() => {
  saveSettings.mockClear()
  pruneHistory.mockClear()
  toast.mockClear()
})
afterEach(cleanup)

const days = () => screen.findByRole('spinbutton', { name: 'Keep runs for this many days' })
const forever = () => screen.getByRole('switch', { name: 'Keep forever' })
const daysShown = () => screen.queryByRole('spinbutton', { name: 'Keep runs for this many days' })

describe('how long the history keeps runs', () => {
  it('shows the stored age in days', async () => {
    stored = { historyKeep: '720h' }
    render(<HistoryCard hueIndex={0} />)
    expect(((await days()) as HTMLInputElement).value).toBe('30')
    expect(forever().getAttribute('aria-checked')).toBe('false')
  })

  it('shows ninety days where nothing is set', async () => {
    stored = {}
    render(<HistoryCard hueIndex={0} />)
    expect(((await days()) as HTMLInputElement).value).toBe('90')
  })

  it('saves days as hours', async () => {
    stored = {}
    render(<HistoryCard hueIndex={0} />)
    fireEvent.change(await days(), { target: { value: '14' } })
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(saveSettings.mock.calls[0]![0].historyKeep).toBe('336h')
  })

  it('reads zero days as keeping every run', async () => {
    stored = {}
    render(<HistoryCard hueIndex={0} />)
    fireEvent.change(await days(), { target: { value: '0' } })
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(saveSettings.mock.calls[0]![0].historyKeep).toBe('0')
    expect(forever().getAttribute('aria-checked')).toBe('true')
    expect(daysShown()).toBeNull()
  })

  it('keeps every run with the switch, and takes the days back up without it', async () => {
    stored = { historyKeep: '336h' }
    render(<HistoryCard hueIndex={0} />)
    await days()
    fireEvent.click(forever())
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(saveSettings.mock.calls[0]![0].historyKeep).toBe('0')
    fireEvent.click(forever())
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(2), { timeout: 2000 })
    expect(saveSettings.mock.calls[1]![0].historyKeep).toBe('336h')
  })
})

describe('deleting the older runs', () => {
  it('says the last run of every job stays', async () => {
    stored = {}
    render(<HistoryCard hueIndex={0} />)
    await days()
    expect(screen.getByText('The last run of every job stays.')).toBeTruthy()
  })

  it('asks first and then deletes', async () => {
    stored = { historyKeep: '720h' }
    render(<HistoryCard hueIndex={0} />)
    await days()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/older than 30 days/)).toBeTruthy()
    expect(pruneHistory).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(pruneHistory).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Runs deleted: 12'))
  })

  it('has nothing to delete while every run is kept', async () => {
    stored = { historyKeep: '0' }
    render(<HistoryCard hueIndex={0} />)
    await screen.findByRole('switch', { name: 'Keep forever' })
    expect(forever().getAttribute('aria-checked')).toBe('true')
    expect(daysShown()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })
})
