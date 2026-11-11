import { describe, expect, it } from 'vitest'

import { en } from './i18n'
import { fortressApps, fortressHues, fortressPermissions, pairedWith, permissionOf, type FortressInfo, type FortressMember } from './fortress'

const t = (key: keyof typeof en, vars: Record<string, string | number> = {}) =>
  en[key].replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all))

function member(over: Partial<FortressMember>): FortressMember {
  return { id: 'm1', app: 'bombvault', name: 'BombVault', version: '9.1.0', device: 'Tower', deployment: 'container', kind: 'instance', online: true, relay: false, ...over }
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

  it('draws a phone as a phone and calls its form the Android app', () => {
    const [app] = fortressApps([member({ deployment: 'phone' })], () => '')
    expect(app.instances[0]).toMatchObject({ deviceKind: 'phone', form: 'android' })
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
})

describe('the colours the fortress takes', () => {
  const info: FortressInfo = { joined: false, phrase: false, device: '', defaultDevice: '', passwordSet: false, members: [], permissions: [] }

  it('takes one for the card outside a fortress', () => {
    expect(fortressHues(info)).toBe(1)
  })

  it('takes one more for each other app once joined', () => {
    const members = [member({ id: 'b1' }), member({ id: 'b2' }), member({ id: 'k1', app: 'knightloader' }), member({ id: 'a1', app: 'arrowloop' })]
    expect(fortressHues({ ...info, joined: true, members })).toBe(5)
  })
})
