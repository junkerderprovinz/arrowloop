// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Job, RawJob } from '../lib/api'
import { GoTo } from '../lib/goTo'
import { LiveJobs } from '../lib/live'
import { OpenJob } from '../lib/openJob'
import { ToastProvider } from '../lib/toast'

const pair = (): RawJob[] => [{ name: 'photos', left: 'D:/Photos', right: 'nas:photos', state: 'state/photos.db' }]

vi.mock('../lib/api', () => ({
  api: {
    capabilities: () => Promise.resolve({ window: false, version: 'test' }),
    config: () => Promise.resolve({ jobs: pair() }),
    saveConfig: (jobs: RawJob[]) => Promise.resolve({ jobs }),
    settings: () => Promise.resolve({}),
    learning: () => Promise.resolve([]),
    volumes: () => Promise.resolve({ volumes: [] }),
    remotes: () => Promise.resolve({ remotes: [], backends: [] }),
    history: () => Promise.resolve([]),
    log: () => Promise.resolve([]),
    historyStats: () => Promise.reject(new Error('none')),
  },
}))

const { Jobs } = await import('./Jobs')
const { JobPage } = await import('./JobPage')

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => undefined

const photos: Job = {
  name: 'photos', left: 'D:/Photos', right: 'nas:photos', direction: 'both', schedule: '', watch: false,
  disabled: false, running: false, lastSuccess: null, recent: [],
}

/** The open menu's rows by name, with a dash for each line between groups. */
function rows(): string[] {
  const menu = screen.getByRole('menu')
  return Array.from(menu.querySelectorAll('[role="menuitem"], [role="separator"]')).map((el) =>
    el.getAttribute('role') === 'separator' ? '-' : (el.textContent ?? '').trim(),
  )
}

async function listMenu(): Promise<string[]> {
  render(
    <ToastProvider>
      <GoTo.Provider value={() => undefined}>
        <OpenJob.Provider value={() => undefined}>
          <Jobs jobs={[photos]} findings={[]} progress={{}} onSaved={() => undefined} />
        </OpenJob.Provider>
      </GoTo.Provider>
    </ToastProvider>,
  )
  await screen.findByRole('button', { name: 'Pause' })
  const card = screen.getByText('photos').closest('li') as HTMLElement
  fireEvent.click(within(card).getByRole('button', { name: 'More' }))
  await screen.findByRole('menuitem', { name: 'Edit' })
  const got = rows()
  cleanup()
  return got
}

async function pageMenu(): Promise<string[]> {
  render(
    <ToastProvider>
      <GoTo.Provider value={() => undefined}>
        <LiveJobs.Provider value={{ jobs: [photos], findings: [], conflicted: [], progress: {}, speeds: {}, onSaved: () => undefined }}>
          <JobPage name="photos" />
        </LiveJobs.Provider>
      </GoTo.Provider>
    </ToastProvider>,
  )
  await screen.findByRole('button', { name: 'Edit' })
  fireEvent.click(screen.getByRole('button', { name: 'More' }))
  await screen.findByRole('menuitem', { name: 'Remove' })
  return rows()
}

afterEach(cleanup)

describe("a job's two More menus", () => {
  it('list the same actions in the same groups, the page leaving out the Edit that stands beside it', async () => {
    const list = await listMenu()
    expect(list).toEqual([
      'Edit', 'Duplicate', '-', 'Preview', 'Check this job', 'Find duplicates', "Open this job's trash", '-', 'Remove',
    ])
    expect(await pageMenu()).toEqual(list.filter((row) => row !== 'Edit'))
  })
})
