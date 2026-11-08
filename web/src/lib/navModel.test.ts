import { describe, expect, it } from 'vitest'

import { barDestinations, moreDestinations, onDestination, sidebarDestinations } from './navModel'
import { parsePins } from './navPins'

const none = { dashboard: false, targets: false, instances: false, anomalies: false }
const all = { dashboard: false, targets: true, instances: true, anomalies: true }
const to = (list: { to: string }[]) => list.map((d) => d.to)

describe('the navigation', () => {
  it('puts Anomalies beside Conflicts while the notes are on', () => {
    expect(to(sidebarDestinations({ dashboard: false, targets: false, instances: false, anomalies: true }))).toEqual([
      '/jobs',
      '/conflicts',
      '/anomalies',
      '/trash',
      '/history',
      '/settings',
    ])
  })

  it('leaves Anomalies out everywhere while the notes are off', () => {
    expect(to(sidebarDestinations(none))).toEqual(['/jobs', '/conflicts', '/trash', '/history', '/settings'])
    expect(to(moreDestinations(none))).toEqual(['/trash', '/targets'])
  })

  it('adds pinned Targets and Instances to the rail before Settings', () => {
    expect(to(sidebarDestinations(all))).toEqual([
      '/jobs',
      '/conflicts',
      '/anomalies',
      '/trash',
      '/history',
      '/targets',
      '/instances',
      '/settings',
    ])
  })

  it('keeps Instances out of the rail and the More sheet until it is pinned', () => {
    const pinnedTargets = { dashboard: false, targets: true, instances: false, anomalies: true }
    expect(to(sidebarDestinations(pinnedTargets))).not.toContain('/instances')
    expect(to(moreDestinations(pinnedTargets))).toEqual(['/anomalies', '/trash', '/targets'])
    expect(to(moreDestinations(all))).toEqual(['/anomalies', '/trash', '/targets', '/instances'])
  })

  it('gives the bar four places, pinned or not', () => {
    for (const extras of [{ dashboard: false, targets: false, instances: false, anomalies: true }, all]) {
      expect(to(barDestinations(extras))).toEqual(['/jobs', '/conflicts', '/history', '/settings'])
    }
  })

  it('puts the Overview first in the rail and on the bar while it is pinned', () => {
    const shown = { ...all, dashboard: true }
    expect(to(sidebarDestinations(shown))[0]).toBe('/dashboard')
    expect(to(barDestinations(shown))).toEqual(['/dashboard', '/jobs', '/conflicts', '/history'])
    expect(to(moreDestinations(shown))).toEqual(['/anomalies', '/trash', '/targets', '/instances', '/settings'])
  })

  it('gives the bar back to Settings and starts the rail on Jobs while the Overview is hidden', () => {
    expect(to(sidebarDestinations(all))[0]).toBe('/jobs')
    expect(to(sidebarDestinations(all))).not.toContain('/dashboard')
    expect(to(moreDestinations(all))).not.toContain('/dashboard')
    expect(to(moreDestinations(all))).not.toContain('/settings')
  })

  it('counts a page below a place as that place', () => {
    const [jobs] = sidebarDestinations(none)
    expect(onDestination('/jobs/photos', jobs!)).toBe(true)
    expect(onDestination('/jobsite', jobs!)).toBe(false)
  })

  it('shows the Overview until somebody hides it', () => {
    expect(parsePins('').dashboard).toBe(true)
  })

  it('reads stored pins and falls back for anything else', () => {
    expect(parsePins('{"targets":"yes","anomalies":true}')).toEqual({ dashboard: true, targets: false, instances: false })
    expect(parsePins('{"targets":true}')).toEqual({ dashboard: true, targets: true, instances: false })
    expect(parsePins('{"instances":true}')).toEqual({ dashboard: true, targets: false, instances: true })
    expect(parsePins('{"dashboard":false}')).toEqual({ dashboard: false, targets: false, instances: false })
    expect(parsePins('not json')).toEqual({ dashboard: true, targets: false, instances: false })
  })
})
