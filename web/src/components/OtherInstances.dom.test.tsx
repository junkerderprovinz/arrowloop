// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Job, OtherInstance } from '../lib/api'

const instances = vi.fn()
const runOnInstance = vi.fn()
const stopOnInstance = vi.fn()
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  api: {
    instances: () => instances(),
    runOnInstance: (id: string, job: string) => runOnInstance(id, job),
    stopOnInstance: (id: string, job: string) => stopOnInstance(id, job),
  },
}))

import { OtherInstances } from './OtherInstances'

const photos: Job = {
  name: 'Photos',
  left: '/mnt/user/photos',
  right: 'nas:photos',
  direction: 'leftToRight',
  schedule: '',
  watch: false,
  disabled: false,
  running: false,
  lastSuccess: null,
  recent: [],
}

const cellar: OtherInstance = { id: 'c'.repeat(40), name: 'Cellar', deployment: 'container', state: 'ok', jobs: [photos] }

beforeEach(() => {
  instances.mockReset()
  runOnInstance.mockReset()
  stopOnInstance.mockReset()
})
afterEach(cleanup)

describe('the other instances', () => {
  it('draws nothing outside a group', async () => {
    instances.mockResolvedValue([])
    const { container } = render(<OtherInstances firstHue={1} />)
    await waitFor(() => expect(instances).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('says so on the Instances page when no other instance is paired', async () => {
    instances.mockResolvedValue([])
    render(<OtherInstances firstHue={0} empty={<p>nobody here</p>} />)
    expect(await screen.findByText('nobody here')).toBeTruthy()
  })

  it('lists the jobs of another instance and starts one there', async () => {
    instances.mockResolvedValue([cellar])
    runOnInstance.mockResolvedValue({ job: 'Photos', status: 'started' })
    render(<OtherInstances firstHue={1} />)
    expect(await screen.findByText('Cellar')).toBeTruthy()
    expect(screen.getByText('Photos')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(runOnInstance).toHaveBeenCalledWith('c'.repeat(40), 'Photos'))
  })

  it('stops a job that runs there', async () => {
    instances.mockResolvedValue([{ ...cellar, jobs: [{ ...photos, running: true }] }])
    stopOnInstance.mockResolvedValue({ stopped: true })
    render(<OtherInstances firstHue={1} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel the run' }))
    await waitFor(() => expect(stopOnInstance).toHaveBeenCalledWith('c'.repeat(40), 'Photos'))
  })

  it('says why an instance shows no jobs', async () => {
    instances.mockResolvedValue([
      { id: 'a'.repeat(40), name: 'Laptop', deployment: 'desktop', state: 'approve' },
      { id: 'b'.repeat(40), name: 'Phone', deployment: 'phone', state: 'waiting' },
    ])
    render(<OtherInstances firstHue={1} />)
    expect(await screen.findByText(/waits for your approval/)).toBeTruthy()
    expect(screen.getByText(/has not approved this instance yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull()
  })
})
