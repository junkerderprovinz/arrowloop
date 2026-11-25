// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RawJob } from '../lib/api'

const config = vi.fn()
const saveConfig = vi.fn()
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: {
    config: () => config(),
    saveConfig: (jobs: RawJob[]) => saveConfig(jobs),
  },
}))

import { SharedListEditor } from './SharedLists'

const JOBS: RawJob[] = [
  { name: 'camera', left: '/a', right: '/b', state: 'camera.db', includeSets: ['Photos'] },
  { name: 'docs', left: '/a', right: '/c', state: 'docs.db', include: ['*.pdf'] },
]

beforeEach(() => {
  config.mockResolvedValue({ jobs: JOBS })
  saveConfig.mockImplementation((jobs: RawJob[]) => Promise.resolve({ jobs }))
})
afterEach(() => {
  cleanup()
  config.mockReset()
  saveConfig.mockReset()
})

const removeButtons = () => screen.getAllByRole('button', { name: 'Remove this list' })

describe('removing a shared list in the settings', () => {
  it('asks first when jobs use the list, and leaves them its patterns before it goes', async () => {
    const onChange = vi.fn()
    render(<SharedListEditor sets={{ Photos: ['*.jpg'], junk: [] }} onChange={onChange} />)
    fireEvent.click(removeButtons()[0]!)
    expect(await screen.findByText(/Jobs that use this list: 1/)).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove this list' }).at(-1)!)
    await waitFor(() => expect(saveConfig).toHaveBeenCalledWith([{ ...JOBS[0], include: ['*.jpg'], includeSets: undefined }, JOBS[1]]))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ junk: [] }))
  })

  it('refuses to remove an empty list a job takes all its files from', async () => {
    const onChange = vi.fn()
    config.mockResolvedValue({ jobs: [{ name: 'videos', left: '/a', right: '/v', state: 'v.db', includeSets: ['Videos'] }] })
    render(<SharedListEditor sets={{ Videos: [] }} onChange={onChange} />)
    fireEvent.click(removeButtons()[0]!)
    expect(await screen.findByText(/the only one these jobs take files from: videos/)).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    expect(saveConfig).not.toHaveBeenCalled()
  })

  it('removes a list no job uses without asking', async () => {
    const onChange = vi.fn()
    render(<SharedListEditor sets={{ Photos: ['*.jpg'], junk: [] }} onChange={onChange} />)
    fireEvent.click(removeButtons()[1]!)
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ Photos: ['*.jpg'] }))
    expect(saveConfig).not.toHaveBeenCalled()
  })
})
