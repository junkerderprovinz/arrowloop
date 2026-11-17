// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
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
      ['Apprise', 'Discord', 'Email', 'Gotify', 'Healthchecks.io', 'Matrix', 'ntfy', 'Slack', 'Webhook'].sort(),
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
      { title: 'Services', names: ['Apprise', 'Discord', 'Gotify', 'Healthchecks.io', 'Matrix', 'ntfy', 'Slack'] },
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
    expect(item('Email').style.getPropertyValue('--provider-tile')).toBe('')
    expect(item('Webhook').style.getPropertyValue('--provider-tile')).toBe('')
  })

  it('adds the channel whose tile is chosen and closes', () => {
    const chooser = openChooser()
    fireEvent.click(within(chooser).getByRole('button', { name: 'Gotify' }))
    expect(screen.queryByRole('dialog')).toBeNull()
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
    fireEvent.change(search, { target: { value: 'telegram' } })
    expect(tiles(chooser)).toEqual([])
    expect(chooser.textContent).toContain('Nothing matches "telegram"')
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
