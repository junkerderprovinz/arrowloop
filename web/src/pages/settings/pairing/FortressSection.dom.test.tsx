// @vitest-environment jsdom
// The fortress on the Pairing tile: outside one, the twelve words join it;
// inside, the Fortress card on top shows the phrase behind the password with
// its QR code, changes it and lets ArrowLoop leave, and every permission
// saves as it is switched.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FortressInfo, FortressPermission } from '../../../lib/fortress'

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const NEW_PHRASE = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'

const calls: string[] = []
const toasts: string[] = []
let joinRefusal: Error | null = null
let openRefusal: Error | null = null
let passwordSet = true

vi.mock('../../../lib/api', async (original) => {
  const actual = await original<typeof import('../../../lib/api')>()
  const wrong = () => Promise.reject(new actual.ApiError('the current password is not right', 403))
  return {
    ...actual,
    api: {
      joinFortress: (phrase: string) => {
        calls.push(`join ${phrase}`)
        return joinRefusal ? Promise.reject(joinRefusal) : Promise.resolve(joined())
      },
      showFortressPhrase: (password: string) =>
        passwordSet && password !== 'hunter2' ? wrong() : Promise.resolve({ phrase: PHRASE, code: PHRASE }),
      changeFortressPhrase: (password: string) => {
        calls.push(`change ${password}`)
        return passwordSet && password !== 'hunter2' ? wrong() : Promise.resolve({ phrase: NEW_PHRASE, code: NEW_PHRASE, left: ['Cellar'] })
      },
      setFortressPermission: (p: FortressPermission) => {
        calls.push(`permission ${p.from} ${p.to} ${p.action} ${p.on}`)
        return Promise.resolve(joined({ permissions: [p] }))
      },
      removeFortressMember: (id: string) => {
        calls.push(`remove ${id}`)
        return Promise.resolve(joined({ removed: [{ app: 'firesquire', name: 'FireSquire', device: 'Tower' }] }))
      },
      leaveFortress: () => {
        calls.push('leave')
        return Promise.resolve(outside())
      },
      openFortressMember: (id: string) => {
        calls.push(`open ${id}`)
        return openRefusal ? Promise.reject(openRefusal) : Promise.resolve({ path: `/fortress/open/ticket-of-${id}` })
      },
      fortressMemberStatus: (id: string, lang: string) => {
        calls.push(`status ${id} ${lang}`)
        return Promise.resolve({
          report: { state: 'ok', needsYou: [{ severity: 'warn', text: 'Two updates wait' }], work: [], next: [] },
          log: [{ at: '2026-11-12T18:00:00Z', level: 'info', text: 'Checked the containers' }],
        })
      },
    },
  }
})

vi.mock('../../../lib/toast', () => ({ useToast: () => (message: string) => toasts.push(message) }))

import { ApiError } from '../../../lib/api'
import { en } from '../../../lib/i18n'
import { FortressSection } from './FortressSection'

function outside(over: Partial<FortressInfo> = {}): FortressInfo {
  return {
    joined: false,
    phrase: false,
    device: 'Tower',
    defaultDevice: 'Tower',
    passwordSet,
    members: [],
    permissions: [],
    removed: [],
    removedHere: false,
    ...over,
  }
}
const joined = (over: Partial<FortressInfo> = {}) => outside({ joined: true, phrase: true, ...over })

const refreshed = vi.fn()

function Page({ start, pairedWith = [] }: { start: FortressInfo; pairedWith?: string[] }) {
  const [fortress, setFortress] = useState(start)
  return <FortressSection fortress={fortress} pairedWith={pairedWith} hueStart={7} onFortress={setFortress} onRefresh={refreshed} />
}

const button = (hook: string) => document.querySelector<HTMLButtonElement>(`[data-fortress="${hook}"]`)!

/** The join window draws its word fields a moment after it opens. */
async function openJoin() {
  fireEvent.click(await screen.findByRole('button', { name: 'Join a fortress' }))
  return waitFor(() => {
    const field = document.querySelector<HTMLInputElement>('[data-word="0"]')
    expect(field).toBeTruthy()
    return field!
  })
}

beforeEach(() => {
  localStorage.clear()
  calls.length = 0
  toasts.length = 0
  joinRefusal = null
  openRefusal = null
  passwordSet = true
  refreshed.mockReset()
})
afterEach(cleanup)

describe('the fortress on the Pairing tile', () => {
  it('joins with the twelve words pasted into the first field', async () => {
    render(<Page start={outside()} />)
    expect(await screen.findByText('Not in a fortress yet')).toBeTruthy()
    fireEvent.change(await openJoin(), { target: { value: PHRASE } })
    expect(document.querySelectorAll<HTMLInputElement>('[data-word]')[11].value).toBe('about')
    await act(async () => fireEvent.click(button('join')))
    expect(calls).toEqual([`join ${PHRASE}`])
    expect(await screen.findByText('ArrowLoop is in the fortress now')).toBeTruthy()
    expect(refreshed).toHaveBeenCalled()
  })

  it('names a mistyped word and keeps the window open', async () => {
    joinRefusal = new ApiError('unknown word', 400, 'unknown_word', { word: 'recieve', position: '7', count: '12' })
    render(<Page start={outside()} />)
    fireEvent.change(await openJoin(), { target: { value: PHRASE } })
    await act(async () => fireEvent.click(button('join')))
    expect((await screen.findByRole('alert')).textContent).toBe(en['pairing.errUnknownWord'].replace('{position}', '7').replace('{word}', 'recieve'))
  })

  it('says so when ArrowLoop is in a fortress already', async () => {
    joinRefusal = new ApiError('this instance is in a fortress already', 409, 'inFortress')
    render(<Page start={outside()} />)
    fireEvent.change(await openJoin(), { target: { value: PHRASE } })
    await act(async () => fireEvent.click(button('join')))
    expect((await screen.findByRole('alert')).textContent).toBe(en['fortress.inFortress'])
  })

  it('says where the phrase comes from in words that fit this page', async () => {
    render(<Page start={outside()} />)
    expect(await screen.findByText(en['fortress.outBody'].replace('{app}', 'ArrowLoop'))).toBeTruthy()
    await openJoin()
    expect(screen.getByText(en['fortress.phraseWhere'])).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/under Instances|instances of ArrowLoop show up here/)
  })

  it('says that the pairing with the other instances comes along', async () => {
    render(<Page start={outside()} pairedWith={['attic']} />)
    await openJoin()
    expect(screen.getByText('ArrowLoop is already paired with attic. Joining moves that pairing into the fortress, so there is nothing to pair again.')).toBeTruthy()
  })

  it('keeps the phrase, its change and leaving together in the Fortress card on top', async () => {
    render(<Page start={joined()} />)
    const card = (await waitFor(() => button('show'))).closest('[data-glim="FortressPairing"]')!
    expect(card.contains(button('open-change'))).toBe(true)
    expect(card.contains(button('open-leave'))).toBe(true)
    expect(document.querySelectorAll('[data-fortress="show"]')).toHaveLength(1)
    expect(card.compareDocumentPosition(button('others')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the phrase with its QR code only after the password', async () => {
    render(<Page start={joined()} />)
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Show phrase' })))
    const field = screen.getByLabelText('Password of ArrowLoop')
    fireEvent.change(field, { target: { value: 'wrong' } })
    await act(async () => fireEvent.click(button('unlock')))
    expect((await screen.findByRole('alert')).textContent).toBe('That password is not right.')
    expect(document.querySelector('[data-fortress="words"]')).toBeNull()
    fireEvent.change(field, { target: { value: 'hunter2' } })
    await act(async () => fireEvent.click(button('unlock')))
    expect(button('words').querySelectorAll('li')).toHaveLength(12)
    expect(document.querySelector('[data-fortress="qr"]')).toBeTruthy()
  })

  it('asks for the password before the phrase changes, and a wrong one changes nothing', async () => {
    render(<Page start={joined()} />)
    fireEvent.click(await waitFor(() => button('open-change')))
    await act(async () => fireEvent.click(button('change')))
    expect(calls).toEqual([])
    fireEvent.change(screen.getByLabelText('Password of ArrowLoop'), { target: { value: 'wrong' } })
    await act(async () => fireEvent.click(button('change-unlock')))
    expect(calls).toEqual(['change wrong'])
    expect((await screen.findByRole('alert')).textContent).toBe('That password is not right.')
    expect(document.querySelector('[data-fortress="words"]')).toBeNull()
  })

  it('keeps the phrase when the password window closes', async () => {
    render(<Page start={joined()} />)
    fireEvent.click(await waitFor(() => button('open-change')))
    await act(async () => fireEvent.click(button('change')))
    await act(async () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }))
    expect(calls).toEqual([])
    expect((await screen.findByRole('alert')).textContent).toBe(en['fortress.changeKept'])
  })

  it('changes the phrase without asking where ArrowLoop has no password', async () => {
    passwordSet = false
    render(<Page start={joined()} />)
    fireEvent.click(await waitFor(() => button('open-change')))
    await act(async () => fireEvent.click(button('change')))
    expect(calls).toEqual(['change '])
    expect(button('words').textContent).toContain('wrong')
  })

  it('changes the phrase for the password and leaves from the Fortress card', async () => {
    render(<Page start={joined()} />)
    expect(await screen.findByText(en['fortress.title'])).toBeTruthy()
    fireEvent.click(button('open-change'))
    expect(screen.getByText(en['fortress.changeAway'])).toBeTruthy()
    await act(async () => fireEvent.click(button('change')))
    fireEvent.change(screen.getByLabelText('Password of ArrowLoop'), { target: { value: 'hunter2' } })
    await act(async () => fireEvent.click(button('change-unlock')))
    expect(calls).toEqual(['change hunter2'])
    expect(button('words').textContent).toContain('wrong')
    expect(screen.getByText(en['fortress.changedLeft'].replace('{devices}', 'Cellar'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(button('open-leave'))
    await act(async () => fireEvent.click(button('leave')))
    expect(calls).toEqual(['change hunter2', 'leave'])
    expect(await screen.findByText('Not in a fortress yet')).toBeTruthy()
    expect(refreshed).toHaveBeenCalled()
  })

  it('saves a permission the moment its switch flips', async () => {
    const start = joined({
      members: [{ id: 'b1', app: 'bombvault', name: 'BombVault', version: '9.1.0', device: 'Tower', deployment: 'container', kind: 'instance', online: true, relay: false, pages: true }],
      permissions: [{ from: 'bombvault', to: 'arrowloop', action: 'backup.export', on: true }],
    })
    render(<Page start={start} />)
    fireEvent.click(await waitFor(() => button('others')))
    const permission = await screen.findByRole('switch', { name: en['fortress.action.backupExport'] })
    await act(async () => fireEvent.click(permission))
    expect(calls).toEqual(['permission bombvault arrowloop backup.export false'])
    expect(toasts).toEqual([`Switched off: ${en['fortress.action.backupExport']}`])
  })

  it('lists the permissions without a filter while every one of them involves ArrowLoop', async () => {
    const start = joined({
      members: [{ id: 'b1', app: 'bombvault', name: 'BombVault', version: '9.1.0', device: 'Tower', deployment: 'container', kind: 'instance', online: true, relay: false, pages: true }],
      permissions: [
        { from: 'bombvault', to: 'arrowloop', action: 'backup.export', on: true },
        { from: 'bombvault', to: 'arrowloop', action: 'backup.import', on: false },
      ],
    })
    render(<Page start={start} />)
    fireEvent.click(await waitFor(() => button('others')))
    await screen.findByRole('switch', { name: en['fortress.action.backupExport'] })
    expect(screen.queryByRole('radiogroup', { name: 'Permissions' })).toBeNull()
    expect(document.querySelectorAll('[data-permission]')).toHaveLength(2)
  })

  describe('Open on another app', () => {
    const vault = { id: 'b1', app: 'bombvault', name: 'BombVault', version: '9.1.0', device: 'Tower', deployment: 'container', kind: 'instance', online: true, relay: false, pages: true }
    const roll = { ...vault, id: 't1', app: 'tollroll', name: 'TollRoll', deployment: 'plugin', pages: false }

    async function openOn(app: string) {
      fireEvent.click(await waitFor(() => button('others')))
      const card = await waitFor(() => document.querySelector(`[data-fortress-app="${app}"]`)!)
      await act(async () => fireEvent.click(card.querySelector<HTMLButtonElement>('[data-fortress="open"]')!))
    }

    it('opens the pages of an app that has them in a tab of their own', async () => {
      const opened = vi.spyOn(window, 'open').mockReturnValue(null)
      render(<Page start={joined({ members: [vault] })} />)
      await openOn('bombvault')
      expect(calls).toEqual(['open b1'])
      expect(opened).toHaveBeenCalledWith('/fortress/open/ticket-of-b1', '_blank', 'noopener')
      opened.mockRestore()
    })

    it('says why an app did not open', async () => {
      openRefusal = new ApiError('no password there', 403, 'ui_no_login')
      const opened = vi.spyOn(window, 'open').mockReturnValue(null)
      render(<Page start={joined({ members: [vault] })} />)
      await openOn('bombvault')
      expect(opened).not.toHaveBeenCalled()
      expect(toasts).toEqual(['This app opens from elsewhere only once it has a password.'])
      opened.mockRestore()
    })

    it('asks for a password here before it opens anything', async () => {
      passwordSet = false
      render(<Page start={joined({ members: [vault] })} />)
      await openOn('bombvault')
      expect(calls).toEqual([])
      expect(toasts).toEqual([en['fortress.openNeedsPassword']])
    })

    it('shows how an app without pages is doing', async () => {
      render(<Page start={joined({ members: [roll] })} />)
      await openOn('tollroll')
      expect(calls).toEqual(['status t1 en'])
      expect(await screen.findByText('Two updates wait')).toBeTruthy()
      expect(screen.getByText('Checked the containers')).toBeTruthy()
    })
  })

  describe('Remove on another app', () => {
    const squire = { id: 'fs1', app: 'firesquire', name: 'FireSquire', version: '1.3.1', device: 'Tower', deployment: 'plugin', kind: 'instance', online: true, relay: false, pages: false }

    it('asks first, then offers the new phrase behind the password', async () => {
      render(<Page start={joined({ members: [squire] })} />)
      fireEvent.click(await waitFor(() => button('others')))
      const card = await waitFor(() => document.querySelector('[data-fortress-app="firesquire"]')!)
      fireEvent.click(within(card as HTMLElement).getByRole('button', { name: 'Remove' }))
      expect(screen.getByRole('dialog', { name: 'Remove FireSquire on Tower?' })).toBeTruthy()
      expect(calls).toEqual([])
      await act(async () => fireEvent.click(button('remove')))
      expect(calls).toEqual(['remove fs1'])
      expect(screen.getByRole('dialog', { name: 'Change the phrase now?' })).toBeTruthy()
      await act(async () => fireEvent.click(button('change')))
      fireEvent.change(screen.getByLabelText('Password of ArrowLoop'), { target: { value: 'hunter2' } })
      await act(async () => fireEvent.click(button('change-unlock')))
      expect(calls).toEqual(['remove fs1', 'change hunter2'])
      expect(button('words').textContent).toContain('wrong')
      expect(refreshed).toHaveBeenCalled()
    })

    it('names who was removed until the phrase changes', async () => {
      render(<Page start={joined({ removed: [{ app: 'firesquire', name: 'FireSquire', device: 'Tower' }] })} />)
      const line = await waitFor(() => button('removed'))
      expect(line.textContent).toContain('Removed: FireSquire on Tower. No new app can join until you change the phrase.')
      expect(within(line).getByRole('button', { name: 'Change phrase' })).toBeTruthy()
    })

    it('says so when another app took ArrowLoop out', async () => {
      render(<Page start={outside({ removedHere: true })} />)
      expect(await screen.findByText('Removed from the fortress')).toBeTruthy()
      expect(screen.getByText('Another app in the fortress removed ArrowLoop. Once the phrase has changed, the new one gets you back in.')).toBeTruthy()
    })
  })
})
