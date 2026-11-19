// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { SERVICE_MARKS } from '@glimstone/core/serviceMarks'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Notify } from '../../lib/notify'

vi.mock('../../lib/api', async (actual) => ({
  ...(await actual<typeof import('../../lib/api')>()),
  api: { jobs: () => Promise.resolve([]) },
}))

// jsdom has no ResizeObserver, which the tiles use to fit their names.
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

const { NotifyCard } = await import('./NotifyCard')

afterEach(cleanup)

function Card({ start = {} }: { start?: Notify }) {
  const [notify, setNotify] = useState<Notify>(start)
  return (
    <>
      <NotifyCard notify={notify} setNotify={setNotify} hueIndex={0} />
      <output data-testid="kinds">{(notify.channels ?? []).map((c) => c.kind).join(' ')}</output>
      <output data-testid="channels">{JSON.stringify(notify.channels ?? [])}</output>
    </>
  )
}

function openChooser() {
  render(<Card />)
  fireEvent.click(screen.getByRole('button', { name: 'Add a channel' }))
  return screen.getByRole('dialog')
}

const tiles = (within: HTMLElement) =>
  Array.from(within.querySelectorAll<HTMLButtonElement>('.glim-provider-pick button.glim-readme-btn'))

describe('the channel chooser', () => {
  it('shows every service as a tile with its mark, by name', () => {
    const chooser = openChooser()
    const names = tiles(chooser).map((b) => b.getAttribute('aria-label'))
    expect(names.sort()).toEqual(
      ['Apprise', 'Discord', 'Email', 'Gotify', 'Healthchecks.io', 'Matrix', 'ntfy', 'Shoutrrr', 'Slack', 'Webhook'].sort(),
    )
    for (const tile of tiles(chooser)) {
      expect(tile.querySelector('.glim-readme-btn-mark svg')).not.toBeNull()
    }
  })

  it('puts the services first and email and webhooks in a section of their own', () => {
    const chooser = openChooser()
    const sections = Array.from(chooser.querySelectorAll('section')).map((s) => ({
      title: s.querySelector('h3')?.textContent,
      names: tiles(s).map((b) => b.getAttribute('aria-label')),
    }))
    expect(sections).toEqual([
      { title: 'Services', names: ['Apprise', 'Discord', 'Gotify', 'Healthchecks.io', 'Matrix', 'ntfy', 'Shoutrrr', 'Slack'] },
      { title: 'Email and webhooks', names: ['Email', 'Webhook'] },
    ])
  })

  it("explains each service in its tile's bubble", () => {
    const chooser = openChooser()
    const item = within(chooser).getByRole('button', { name: 'ntfy' }).closest('li')!
    expect(item.querySelector('.glim-readme-btn-hint')).not.toBeNull()
    expect(item.textContent).not.toContain('Publishes each message')
  })

  it("lights a brand's tile in its own colour and a generic one in the accent", () => {
    const chooser = openChooser()
    const item = (name: string) => within(chooser).getByRole('button', { name }).closest('li')!
    expect(item('Discord').style.getPropertyValue('--provider-tile')).toBe('#5865f2')
    expect(item('Shoutrrr').style.getPropertyValue('--provider-tile')).toBe('#f5d089')
    expect(item('Email').style.getPropertyValue('--provider-tile')).toBe('')
    expect(item('Webhook').style.getPropertyValue('--provider-tile')).toBe('')
  })

  it('adds the channel whose tile is chosen and closes', () => {
    const chooser = openChooser()
    fireEvent.click(within(chooser).getByRole('button', { name: 'Gotify' }))
    expect(screen.getByRole('dialog').getAttribute('data-glim')).not.toBe('PickerWindow')
    expect(screen.getByTestId('kinds').textContent).toBe('gotify')
  })

  it('adds a second channel of a service already there', () => {
    render(<Card start={{ channels: [{ id: 'slack', kind: 'slack', enabled: true, on: 'failure', slack: { url: '' } }] }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a channel' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Slack' }))
    expect(screen.getByTestId('kinds').textContent).toBe('slack slack')
  })

  it('reaches every tile by keyboard as a plain button', () => {
    const chooser = openChooser()
    for (const tile of tiles(chooser)) {
      expect(tile.tagName).toBe('BUTTON')
      expect(tile.getAttribute('type')).toBe('button')
      expect(tile.tabIndex).toBe(0)
    }
    const slack = within(chooser).getByRole('button', { name: 'Slack' })
    slack.focus()
    expect(document.activeElement).toBe(slack)
    expect(slack.classList).toContain('glim-brand-tile')
  })

  it('narrows the tiles to what the search names, and says so when nothing is left', () => {
    const chooser = openChooser()
    const search = within(chooser).getByRole('searchbox', { name: 'Search services' })
    fireEvent.change(search, { target: { value: 'mail' } })
    expect(tiles(chooser).map((b) => b.getAttribute('aria-label'))).toEqual(['Email'])
    fireEvent.change(search, { target: { value: 'smtp' } })
    expect(tiles(chooser).map((b) => b.getAttribute('aria-label'))).toEqual(['Email'])
    fireEvent.change(search, { target: { value: 'carrier pigeon' } })
    expect(tiles(chooser)).toEqual([])
    expect(chooser.textContent).toContain('Nothing matches "carrier pigeon"')
  })

  it('finds Shoutrrr by the services it reaches', () => {
    const chooser = openChooser()
    const search = within(chooser).getByRole('searchbox', { name: 'Search services' })
    for (const service of ['telegram', 'Pushover', 'teams']) {
      fireEvent.change(search, { target: { value: service } })
      expect(tiles(chooser).map((b) => b.getAttribute('aria-label'))).toEqual(['Shoutrrr'])
    }
  })

  it('takes the marks GlimStone carries and keeps its own drawing of Shoutrrr', () => {
    const chooser = openChooser()
    const drawn = (name: string) => within(chooser).getByRole('button', { name }).querySelector('.glim-brand-svg')!.innerHTML
    const as = (svg: string) => {
      const box = document.createElement('div')
      box.innerHTML = svg
      return box.innerHTML
    }
    for (const [name, id] of [['Gotify', 'gotify'], ['Slack', 'slack'], ['Apprise', 'apprise'], ['Healthchecks.io', 'healthchecks']] as const) {
      expect(drawn(name), name).toBe(as(SERVICE_MARKS[id].svg))
    }
    expect(drawn('Shoutrrr')).not.toBe(as(SERVICE_MARKS.shoutrrr.svg))
    expect(drawn('Shoutrrr')).toContain('var(--brand-shoutrrr-0)')
  })

  it("puts the What's new dot of Shoutrrr on its tile", () => {
    const chooser = openChooser()
    expect(chooser.querySelector('[data-new="notify-shoutrrr"]')?.closest('button')?.getAttribute('aria-label')).toBe('Shoutrrr')
  })

  it('picks the one tile a search leaves on Enter', () => {
    const chooser = openChooser()
    const search = within(chooser).getByRole('searchbox', { name: 'Search services' })
    fireEvent.change(search, { target: { value: 'pushover' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(screen.getByRole('dialog').getAttribute('data-glim')).not.toBe('PickerWindow')
    expect(screen.getByTestId('kinds').textContent).toBe('shoutrrr')
  })

  it('goes down from the search to the first tile', () => {
    const chooser = openChooser()
    const search = within(chooser).getByRole('searchbox', { name: 'Search services' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Apprise')
  })

  it("empties the search with a button named in the page's language", () => {
    const chooser = openChooser()
    const search = within(chooser).getByRole('searchbox', { name: 'Search services' }) as HTMLInputElement
    expect(within(chooser).queryByRole('button', { name: 'Clear the search' })).toBeNull()
    fireEvent.change(search, { target: { value: 'slack' } })
    fireEvent.click(within(chooser).getByRole('button', { name: 'Clear the search' }))
    expect(search.value).toBe('')
    expect(tiles(chooser)).toHaveLength(10)
  })

  it('empties the search on Escape before it lets the window close', () => {
    const chooser = openChooser()
    const search = within(chooser).getByRole('searchbox', { name: 'Search services' })
    fireEvent.change(search, { target: { value: 'slack' } })
    fireEvent.keyDown(search, { key: 'Escape' })
    expect((search as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })
})

describe('a channel', () => {
  it('stands as a connection row that says when it sends', () => {
    render(<Card start={{ channels: [{ id: 'phone', kind: 'ntfy', enabled: true, on: 'always', ntfy: { url: '********' } }] }} />)
    const row = screen.getByRole('group', { name: 'ntfy' })
    expect(row.getAttribute('data-glim')).toBe('ConnectionRow')
    expect(within(row).getByText('After every run')).toBeTruthy()
    for (const name of ['Send a test', 'Edit', 'Remove']) expect(within(row).getByRole('button', { name })).toBeTruthy()
  })

  it('offers no test while it is switched off', () => {
    render(<Card start={{ channels: [{ id: 'phone', kind: 'ntfy', enabled: false, ntfy: { url: '********' } }] }} />)
    const row = screen.getByRole('group', { name: 'ntfy' })
    expect(within(row).getByText('Never')).toBeTruthy()
    expect(within(row).queryByRole('button', { name: 'Send a test' })).toBeNull()
  })

  it('opens its settings as soon as it is added', () => {
    render(<Card />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a channel' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ntfy' }))
    expect(within(screen.getByRole('dialog')).getByRole('switch', { name: 'Send here' })).toBeTruthy()
  })

  it('goes with its Remove button', () => {
    render(<Card start={{ channels: [{ id: 'phone', kind: 'ntfy', enabled: true, ntfy: { url: '********' } }] }} />)
    fireEvent.click(within(screen.getByRole('group', { name: 'ntfy' })).getByRole('button', { name: 'Remove' }))
    expect(screen.getByTestId('kinds').textContent).toBe('')
  })
})

describe('a Shoutrrr channel', () => {
  it('takes its addresses in one field, separated by spaces', () => {
    render(<Card />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a channel' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Shoutrrr' }))
    const field = screen.getByLabelText('Address')
    expect(field.getAttribute('type')).toBe('password')
    fireEvent.change(field, { target: { value: 'telegram://token@telegram?chats=1  pushover://shoutrrr:app@user ' } })
    const [channel] = JSON.parse(screen.getByTestId('channels').textContent!)
    expect(channel).toMatchObject({
      kind: 'shoutrrr',
      enabled: true,
      on: 'failure',
      shoutrrr: { urls: ['telegram://token@telegram?chats=1', 'pushover://shoutrrr:app@user'] },
    })
  })

  it('keeps a space typed after an address, so a second one can follow', () => {
    render(<Card />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a channel' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Shoutrrr' }))
    const field = screen.getByLabelText<HTMLInputElement>('Address')
    fireEvent.change(field, { target: { value: 'telegram://token@telegram?chats=1 ' } })
    expect(field.value).toBe('telegram://token@telegram?chats=1 ')
  })

  it('shows addresses the engine keeps as saved', () => {
    render(<Card start={{ channels: [{ id: 'shoutrrr', kind: 'shoutrrr', enabled: true, shoutrrr: { urls: ['********'] } }] }} />)
    fireEvent.click(within(screen.getByRole('group', { name: 'Shoutrrr' })).getByRole('button', { name: 'Edit' }))
    expect(screen.getByText('Saved')).toBeTruthy()
    expect(screen.queryByLabelText('Address')).toBeNull()
  })
})
