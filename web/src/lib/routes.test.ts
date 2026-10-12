import { describe, expect, it } from 'vitest'

import { resolveRoute, TILE_IDS, type RouteContext } from './routes'

const ctx = (over: Partial<RouteContext> = {}): RouteContext => ({
  pins: { targets: false, anomalies: false },
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

  it('open on the welcome page while there is no job yet', () => {
    expect(go('/', { fresh: true })).toEqual({ redirect: '/welcome' })
    expect(go('/welcome', { fresh: true })).toEqual({ view: { page: 'welcome' } })
  })

  it('hold the start back until the jobs are read', () => {
    expect(go('/', { fresh: null })).toEqual({ wait: true })
  })

  it('give each job a page and its preview an address below it', () => {
    expect(go('/jobs/photos%20raw')).toEqual({ view: { page: 'job', name: 'photos raw' } })
    expect(go('/jobs/photos/preview')).toEqual({ view: { page: 'preview', name: 'photos' } })
  })

  it('send an unpinned page to its settings tile and keep what the link asked for', () => {
    expect(go('/anomalies?job=photos')).toEqual({ redirect: '/settings/anomalies?job=photos' })
    expect(go('/targets')).toEqual({ redirect: '/settings/targets' })
  })

  it('serve a pinned page at its own address', () => {
    expect(go('/targets', { pins: { targets: true, anomalies: false } })).toEqual({ view: { page: 'targets' } })
  })

  it('open Settings on the tile that was open last', () => {
    expect(go('/settings', { remembered: 'workload' })).toEqual({ redirect: '/settings/workload' })
  })

  it('open Settings on its first tile when the remembered one is gone', () => {
    const tiles = TILE_IDS.filter((t) => t !== 'security')
    expect(go('/settings', { remembered: 'security', tiles })).toEqual({ redirect: '/settings/general' })
  })

  it('lead the old Engine tab to Sync', () => {
    expect(go('/settings/engine')).toEqual({ redirect: '/settings/sync' })
  })

  it('send a tile nobody made to the first one', () => {
    expect(go('/settings/nothing')).toEqual({ redirect: '/settings/general' })
  })

  it('send an unknown address to the jobs', () => {
    expect(go('/overview')).toEqual({ redirect: '/jobs' })
  })
})
