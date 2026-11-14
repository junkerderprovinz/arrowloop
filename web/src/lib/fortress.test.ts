import { describe, expect, it } from 'vitest'

import { en } from './i18n'
import { fortressApps, fortressHues, fortressPermissions, leftNames, pairedWith, permissionOf, statusLines, type FortressInfo, type FortressMember } from './fortress'

const t = (key: keyof typeof en, vars: Record<string, string | number> = {}) =>
  en[key].replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all))

function member(over: Partial<FortressMember>): FortressMember {
  return { id: 'm1', app: 'bombvault', name: 'BombVault', version: '9.1.0', device: 'Tower', deployment: 'container', kind: 'instance', online: true, relay: false, pages: true, ...over }
}

describe('the other apps of the fortress', () => {
  it('groups the instances by app, leaves ArrowLoop out and sorts by name', () => {
    const apps = fortressApps(
      [
        member({ id: 'k1', app: 'knightloader', name: 'KnightLoader', device: 'Desk' }),
        member({ id: 'b1' }),
        member({ id: 'b2', device: 'Cellar', online: false, lastSeen: 1_700_000_000 }),
        member({ id: 'a1', app: 'arrowloop', name: 'ArrowLoop', device: 'Laptop' }),
      ],
      () => 'an hour ago',
    )
    expect(apps.map((a) => a.id)).toEqual(['bombvault', 'knightloader'])
    expect(apps[0].instances.map((i) => [i.device, i.presence, i.lastSeen])).toEqual([
      ['Tower', 'connected', undefined],
      ['Cellar', 'away', 'an hour ago'],
    ])
  })

  it('shows a member that never said its app by its device, away and with nothing to open', () => {
    const apps = fortressApps(
      [
        member({ id: 'cellar-member', app: '', name: '', version: '', device: 'Cellar', deployment: 'plugin', online: false, pages: false, lastSeen: 1000 }),
        member({ id: 'attic-member', app: '', name: '', version: '', device: 'Attic', deployment: '', online: false, pages: false }),
      ],
      () => 'an hour ago',
    )
    expect(apps.map((a) => a.name)).toEqual(['Attic', 'Cellar'])
    expect(apps[1].instances).toEqual([
      { id: 'cellar-member', device: 'Cellar', deviceKind: 'server', form: 'plugin', version: undefined, presence: 'away', relay: false, lastSeen: 'an hour ago', open: undefined, doubt: false, print: 'r-member' },
    ])
  })

  it('names the app beside every device a phrase change missed, and the device alone where the app is unknown', () => {
    const names = leftNames(
      [
        { app: 'BombVault', device: 'Tower' },
        { app: 'FireSquire', device: 'Tower' },
        { app: '', device: 'Cellar' },
      ],
      (app, device) => `${app} on ${device}`,
    )
    expect(names).toEqual(['BombVault on Tower', 'FireSquire on Tower', 'Cellar'])
  })

  it('draws a phone as a phone and calls its form the Android app', () => {
    const [app] = fortressApps([member({ deployment: 'phone' })], () => '')
    expect(app.instances[0]).toMatchObject({ deviceKind: 'phone', form: 'android' })
  })
})

describe('opening another app', () => {
  it('offers Open on every instance and names each by the end of its id', () => {
    const [app] = fortressApps([member({ id: '0123456789abcdef' }), member({ id: 'fedcba9876543210', app: 'tollroll', deployment: 'plugin', pages: false })], () => '')
    expect(app.instances[0]).toMatchObject({ open: {}, print: '89abcdef', doubt: false })
  })

  it('asks first where two members claim one app on one server or device', () => {
    const apps = fortressApps(
      [
        member({ id: 'b1', host: 'Tower', device: 'Tower' }),
        member({ id: 'b2', host: 'Tower', device: 'Tower vault' }),
        member({ id: 'b3', host: 'Cellar', device: 'Cellar' }),
        member({ id: 'k1', app: 'knightloader', name: 'KnightLoader', device: 'Desk' }),
        member({ id: 'k2', app: 'knightloader', name: 'KnightLoader', device: 'Desk' }),
        member({ id: 'k3', app: 'knightloader', name: 'KnightLoader', device: 'Attic' }),
      ],
      () => '',
    )
    expect(apps.find((a) => a.id === 'bombvault')!.instances.map((i) => [i.id, i.doubt])).toEqual([
      ['b1', true],
      ['b2', true],
      ['b3', false],
    ])
    expect(apps.find((a) => a.id === 'knightloader')!.instances.map((i) => i.doubt)).toEqual([true, true, false])
  })
})

describe('the status window of a member', () => {
  it('puts the times of the report and the log in words of the reader', () => {
    const when = (at: string) => `at ${at.slice(11, 16)}`
    const { report, log } = statusLines(
      {
        report: {
          state: 'warning',
          needsYou: [{ severity: 'warn', text: 'An update waits' }],
          work: [{ title: 'Backup', progress: 0.5 }, { title: 'Check' }],
          next: [{ title: 'Nightly', at: '2026-11-13T03:00:00Z' }],
        },
        log: [{ at: '2026-11-12T18:00:00Z', level: 'info', text: 'Opened from ArrowLoop on Tower (89abcdef).' }],
      },
      when,
    )
    expect(report).toEqual({
      state: 'warning',
      needsYou: [{ severity: 'warn', text: 'An update waits' }],
      work: [{ title: 'Backup', progress: 0.5 }, { title: 'Check' }],
      next: [{ title: 'Nightly', at: 'at 03:00' }],
    })
    expect(log).toEqual([{ at: 'at 18:00', level: 'info', text: 'Opened from ArrowLoop on Tower (89abcdef).' }])
  })
})

describe('the permissions that involve ArrowLoop', () => {
  it('names the action in ArrowLoop words and the two apps by their names', () => {
    const [p] = fortressPermissions([{ from: 'bombvault', to: 'arrowloop', action: 'backup.export', on: true }], [member({})], t)
    expect(p).toEqual({
      id: 'bombvault arrowloop backup.export',
      from: 'bombvault',
      to: ['arrowloop'],
      on: true,
      title: en['fortress.action.backupExport'],
      detail: t('fortress.permissionPair', { from: 'BombVault', to: 'ArrowLoop' }),
    })
  })

  it('shows an action it has no words for as it is named', () => {
    const [p] = fortressPermissions([{ from: 'bombvault', to: 'arrowloop', action: 'events.read', on: false }], [], t)
    expect(p.title).toBe('events.read')
    expect(p.detail).toBe(t('fortress.permissionPair', { from: 'bombvault', to: 'ArrowLoop' }))
  })

  it('turns a switch back into the permission it stands for', () => {
    expect(permissionOf('bombvault arrowloop jobs.run', false)).toEqual({ from: 'bombvault', to: 'arrowloop', action: 'jobs.run', on: false })
  })
})

describe('the pairing that moves into the fortress', () => {
  it('names every approved instance, whether it is there or away', () => {
    const names = pairedWith({
      members: [
        { id: '1', name: 'Tower', approved: true },
        { id: '2', name: 'Stranger', approved: false },
        { id: '3', name: '', approved: true },
      ],
      away: [{ id: '4', name: 'Laptop' }],
    })
    expect(names).toEqual(['Tower', '3', 'Laptop'])
  })

  it('names a device once when it was paired again under a new key', () => {
    const names = pairedWith({ members: [{ id: '1', name: 'Pixel', approved: true }], away: [{ id: '2', name: 'Pixel' }] })
    expect(names).toEqual(['Pixel'])
  })
})

describe('the colours the fortress takes', () => {
  const info: FortressInfo = { joined: false, phrase: false, device: '', defaultDevice: '', passwordSet: false, members: [], permissions: [], removed: [], removedHere: false, phraseChanged: false }

  it('takes one for the card outside a fortress', () => {
    expect(fortressHues(info)).toBe(1)
  })

  it('takes one more for each other app once joined', () => {
    const members = [member({ id: 'b1' }), member({ id: 'b2' }), member({ id: 'k1', app: 'knightloader' }), member({ id: 'a1', app: 'arrowloop' })]
    expect(fortressHues({ ...info, joined: true, members })).toBe(5)
  })

  it('takes one for each member known by its device alone', () => {
    const members = [member({ id: 'b1' }), member({ id: 'u1', app: '' }), member({ id: 'u2', app: '' })]
    expect(fortressHues({ ...info, joined: true, members })).toBe(6)
  })
})
