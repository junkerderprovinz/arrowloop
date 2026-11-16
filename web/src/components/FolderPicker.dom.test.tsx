// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { FolderListing } from '../lib/api'
import { HostContext, type Host } from '../lib/host'
import { FolderPicker } from './FolderPicker'

afterEach(cleanup)

/** A host whose listings arrive only when the test lets them. */
function slowHost() {
  const waiting = new Map<string, (listing: FolderListing) => void>()
  const host: Host = {
    browse: (path = '') => new Promise((resolve) => waiting.set(path, resolve)),
    makeDir: (at: string, name: string) => Promise.resolve({ path: `${at}/${name}` }),
    excludeSets: () => Promise.resolve([]),
  }
  const answer = async (path: string, names: string[]) => {
    waiting.get(path)!({
      path,
      parent: '',
      entries: names.map((name) => ({ name, path: `${path}/${name}` })),
    } as FolderListing)
    await waitFor(() => expect(screen.queryByText('Listing the folders…')).toBeNull())
  }
  return { host, answer }
}

function open(host: Host) {
  render(
    <HostContext.Provider value={host}>
      <FolderPicker open start="nas:photos" onPick={() => {}} onClose={() => {}} />
    </HostContext.Provider>,
  )
}

describe('the folder picker', () => {
  it('says it is listing while a folder on a target has not answered', async () => {
    const { host, answer } = slowHost()
    open(host)
    expect(screen.getByText('Listing the folders…')).toBeTruthy()
    await answer('nas:photos', ['2025', '2026'])
    expect(screen.queryByText('Listing the folders…')).toBeNull()
  })

  it('hides the folder it leaves while the next one is listed', async () => {
    const { host, answer } = slowHost()
    open(host)
    await answer('nas:photos', ['2025', '2026'])
    fireEvent.click(screen.getByText('2026'))
    expect(screen.getByText('Listing the folders…')).toBeTruthy()
    expect(screen.queryByText('2025')).toBeNull()
  })

  it('says a folder without subfolders is empty once it has answered', async () => {
    const { host, answer } = slowHost()
    open(host)
    await answer('nas:photos', ['2026'])
    fireEvent.click(screen.getByText('2026'))
    await answer('nas:photos/2026', [])
    expect(screen.getByText('No folders in here.')).toBeTruthy()
    expect(screen.queryByText('Listing the folders…')).toBeNull()
  })

  it('names the target it opens before the target answers', () => {
    const { host } = slowHost()
    open(host)
    expect(screen.getByText('nas:photos')).toBeTruthy()
    expect(screen.queryByText('Drives and roots')).toBeNull()
  })

  it('names the folder it opens while that folder is listed', async () => {
    const { host, answer } = slowHost()
    open(host)
    await answer('nas:photos', ['2026'])
    fireEvent.click(screen.getByText('2026'))
    expect(screen.getByText('nas:photos/2026')).toBeTruthy()
  })

  it('offers the folder buttons only once the folder being opened has answered', async () => {
    const { host, answer } = slowHost()
    open(host)
    await answer('nas:photos', ['2026'])
    fireEvent.click(screen.getByText('2026'))
    const choose = () => screen.getByRole('button', { name: 'Use this folder' }) as HTMLButtonElement
    const make = () => screen.getByRole('button', { name: 'New folder' }) as HTMLButtonElement
    expect(choose().disabled).toBe(true)
    expect(make().disabled).toBe(true)
    await answer('nas:photos/2026', [])
    expect(choose().disabled).toBe(false)
    expect(make().disabled).toBe(false)
  })

  it('lists hidden folders once the switch is on and remembers the switch', async () => {
    localStorage.clear()
    const asked: { path: string; hidden: boolean }[] = []
    const host: Host = {
      browse: (path = '', hidden = false) => {
        asked.push({ path, hidden })
        const names = hidden ? ['.backup', 'Music'] : ['Music']
        return Promise.resolve({
          path,
          parent: '',
          entries: names.map((name) => ({ name, path: `${path}/${name}` })),
        } as FolderListing)
      },
      excludeSets: () => Promise.resolve([]),
    }
    open(host)
    await screen.findByText('Music')
    expect(screen.queryByText('.backup')).toBeNull()
    const hidden = () => screen.getByRole('switch', { name: 'Show hidden folders' })
    expect(hidden().getAttribute('aria-checked')).toBe('false')

    fireEvent.click(hidden())
    await screen.findByText('.backup')
    expect(asked.at(-1)).toEqual({ path: 'nas:photos', hidden: true })

    cleanup()
    asked.length = 0
    open(host)
    await screen.findByText('.backup')
    expect(hidden().getAttribute('aria-checked')).toBe('true')
    expect(asked).toEqual([{ path: 'nas:photos', hidden: true }])
    localStorage.clear()
  })
})
