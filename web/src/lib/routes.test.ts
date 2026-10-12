import { describe, expect, it } from 'vitest'

import { jobPlace, resolveRoute, TAB_IDS, type RouteContext } from './routes'

const ctx = (over: Partial<RouteContext> = {}): RouteContext => ({
  pins: { targets: false },
  anomalies: true,
  tabs: TAB_IDS,
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

  it('give each job a page, and lead its old preview address there', () => {
    expect(go('/jobs/photos%20raw')).toEqual({ view: { page: 'job', name: 'photos raw' } })
    expect(go('/jobs/photos%20raw/preview')).toEqual({ redirect: '/jobs/photos%20raw' })
  })

  it('send unpinned Targets to its settings tab and keep what the link asked for', () => {
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
    expect(go('/targets', { pins: { targets: true } })).toEqual({ view: { page: 'targets' } })
  })

  it('open Settings on the tab that was open last', () => {
    expect(go('/settings', { remembered: 'safety' })).toEqual({ redirect: '/settings/safety' })
  })

  it('open Settings where a remembered tile went', () => {
    expect(go('/settings', { remembered: 'workload' })).toEqual({ redirect: '/settings/general' })
  })

  it('open Settings on its first tab when the remembered one is gone', () => {
    const tabs = TAB_IDS.filter((t) => t !== 'security')
    expect(go('/settings', { remembered: 'security', tabs })).toEqual({ redirect: '/settings/general' })
  })

  it('lead every old tile to the tab that holds its cards', () => {
    expect(go('/settings/engine')).toEqual({ redirect: '/settings/sync' })
    expect(go('/settings/workload')).toEqual({ redirect: '/settings/general' })
    expect(go('/settings/exclude')).toEqual({ redirect: '/settings/sync' })
    expect(go('/settings/notifications')).toEqual({ redirect: '/settings/safety' })
    expect(go('/settings/anomalies?job=photos')).toEqual({ redirect: '/settings/safety?job=photos' })
    expect(go('/settings/app')).toEqual({ redirect: '/settings/apps' })
  })

  it('send a tab nobody made to the first one', () => {
    expect(go('/settings/nothing')).toEqual({ redirect: '/settings/general' })
  })

  it('send an unknown address to the jobs', () => {
    expect(go('/overview')).toEqual({ redirect: '/jobs' })
  })
})
