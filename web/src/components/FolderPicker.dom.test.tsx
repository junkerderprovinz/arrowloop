// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    excludeSets: () => Promise.resolve([]),
  }
  const answer = async (path: string, names: string[]) => {
    waiting.get(path)!({
      path,
      parent: '',
      entries: names.map((name) => ({ name, path: `${path}/${name}` })),
    } as FolderListing)
    await screen.findByText(path)
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
})
