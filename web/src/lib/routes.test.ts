import { describe, expect, it } from 'vitest'

import { jobPlace, remoteJobPath, resolveRoute, TILE_IDS, type RouteContext } from './routes'

const ctx = (over: Partial<RouteContext> = {}): RouteContext => ({
  pins: { dashboard: false, targets: false, instances: false },
  anomalies: true,
  tiles: TILE_IDS,
  remembered: null,
  ...over,
})

const go = (path: string, over?: Partial<RouteContext>) => {
  const url = new URL(path, 'http://x')
  return resolveRoute(url.pathname, url.searchParams, ctx(over))
}

describe('the addresses', () => {
  it('open on the jobs', () => {
    expect(go('/')).toEqual({ redirect: '/jobs' })
  })

  it('open on the Overview while it is pinned', () => {
    const pins = { dashboard: true, targets: false, instances: false }
    expect(go('/', { pins })).toEqual({ redirect: '/dashboard' })
    expect(go('/dashboard', { pins })).toEqual({ view: { page: 'dashboard' } })
    expect(go('/dashboard/x', { pins })).toEqual({ redirect: '/dashboard' })
    expect(go('/nowhere', { pins })).toEqual({ redirect: '/dashboard' })
  })

  it('lead the Overview to the jobs while it is hidden', () => {
    expect(go('/dashboard')).toEqual({ redirect: '/jobs' })
  })

  it('open on the welcome page while there is no job yet', () => {
    expect(go('/', { fresh: true, pins: { dashboard: true, targets: false, instances: false } })).toEqual({ redirect: '/welcome' })
    expect(go('/', { fresh: true })).toEqual({ redirect: '/welcome' })
    expect(go('/welcome', { fresh: true })).toEqual({ view: { page: 'welcome' } })
  })

  it('hold the start back until the jobs are read', () => {
    expect(go('/', { fresh: null })).toEqual({ wait: true })
  })

  it('give each job a page, and lead its old preview address there', () => {
    expect(go('/jobs/photos%20raw')).toEqual({ view: { page: 'job', name: 'photos raw' } })
    expect(go('/jobs/photos%20raw/preview')).toEqual({ redirect: '/jobs/photos%20raw' })
  })

  it('give a job address with a broken escape a page that finds no job', () => {
    expect(go('/jobs/%E0')).toEqual({ view: { page: 'job', name: '%E0' } })
  })

  it('send unpinned Targets to its settings tile and keep what the link asked for', () => {
    expect(go('/targets?x=1')).toEqual({ redirect: '/settings/targets?x=1' })
  })

  it('serve Anomalies at its own address while the notes are on', () => {
    expect(go('/anomalies?job=photos')).toEqual({ view: { page: 'anomalies' } })
  })

  it('send Anomalies to the jobs while the notes are off, and wait until that is known', () => {
    expect(go('/anomalies', { anomalies: false })).toEqual({ redirect: '/jobs' })
    expect(go('/anomalies', { anomalies: null })).toEqual({ wait: true })
  })

  it('carry the finding a link opens on Anomalies', () => {
    expect(jobPlace('anomalies', 'photos raw', 'f1')).toBe('/anomalies?job=photos%20raw&finding=f1')
    expect(jobPlace('jobs', '')).toBe('/jobs')
  })

  it('serve a pinned page at its own address', () => {
    expect(go('/targets', { pins: { dashboard: false, targets: true, instances: false } })).toEqual({ view: { page: 'targets' } })
    expect(go('/instances', { pins: { dashboard: false, targets: false, instances: true } })).toEqual({ view: { page: 'instances' } })
  })

  it('lead an unpinned Instances page to the Pairing tile that holds it', () => {
    expect(go('/instances')).toEqual({ redirect: '/settings/pairing' })
    expect(go('/instances/x', { pins: { dashboard: false, targets: false, instances: true } })).toEqual({ redirect: '/instances' })
  })

  it('open a job of another instance at its own address, pinned or not', () => {
    const id = 'c'.repeat(40)
    expect(go(`/instances/${id}/jobs/My%20photos`)).toEqual({ view: { page: 'remoteJob', instance: id, name: 'My photos' } })
    expect(remoteJobPath(id, 'a/b')).toBe(`/instances/${id}/jobs/a%2Fb`)
    expect(go(`/instances/${id}/jobs`)).toEqual({ redirect: '/instances' })
  })

  it('open Settings on the tile that was open last', () => {
    expect(go('/settings', { remembered: 'safety' })).toEqual({ redirect: '/settings/safety' })
  })

  it('open Settings where a remembered tile went', () => {
    expect(go('/settings', { remembered: 'workload' })).toEqual({ redirect: '/settings/general' })
  })

  it('open Settings on its first tile when the remembered one is gone', () => {
    const tiles = TILE_IDS.filter((t) => t !== 'security')
    expect(go('/settings', { remembered: 'security', tiles })).toEqual({ redirect: '/settings/general' })
  })

  it('lead every old address to the tile that holds its cards', () => {
    expect(go('/settings/engine')).toEqual({ redirect: '/settings/sync' })
    expect(go('/settings/workload')).toEqual({ redirect: '/settings/general' })
    expect(go('/settings/exclude')).toEqual({ redirect: '/settings/sync' })
    expect(go('/settings/notifications')).toEqual({ redirect: '/settings/safety' })
    expect(go('/settings/anomalies?job=photos')).toEqual({ redirect: '/settings/safety?job=photos' })
    expect(go('/settings/app')).toEqual({ redirect: '/settings/apps' })
  })

  it('send a tile nobody made to the first one', () => {
    expect(go('/settings/nothing')).toEqual({ redirect: '/settings/general' })
  })

  it('send an unknown address to the jobs', () => {
    expect(go('/overview')).toEqual({ redirect: '/jobs' })
  })
})
