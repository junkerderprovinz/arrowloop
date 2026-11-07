import { describe, expect, it } from 'vitest'

import { barDestinations, moreDestinations, onDestination, sidebarDestinations } from './navModel'
import { parsePins } from './navPins'

const none = { targets: false, instances: false, anomalies: false }
const all = { targets: true, instances: true, anomalies: true }
const to = (list: { to: string }[]) => list.map((d) => d.to)

describe('the navigation', () => {
  it('puts Anomalies beside Conflicts while the notes are on', () => {
    expect(to(sidebarDestinations({ targets: false, instances: false, anomalies: true }))).toEqual([
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
    const pinnedTargets = { targets: true, instances: false, anomalies: true }
    expect(to(sidebarDestinations(pinnedTargets))).not.toContain('/instances')
    expect(to(moreDestinations(pinnedTargets))).toEqual(['/anomalies', '/trash', '/targets'])
    expect(to(moreDestinations(all))).toEqual(['/anomalies', '/trash', '/targets', '/instances'])
  })

  it('gives the bar four places, pinned or not', () => {
    for (const extras of [{ targets: false, instances: false, anomalies: true }, all]) {
      expect(to(barDestinations(extras))).toEqual(['/jobs', '/conflicts', '/history', '/settings'])
    }
  })

  it('counts a page below a place as that place', () => {
    const [jobs] = sidebarDestinations(none)
    expect(onDestination('/jobs/photos', jobs!)).toBe(true)
    expect(onDestination('/jobsite', jobs!)).toBe(false)
  })

  it('reads stored pins and falls back for anything else', () => {
    expect(parsePins('{"targets":"yes","anomalies":true}')).toEqual({ targets: false, instances: false })
    expect(parsePins('{"targets":true}')).toEqual({ targets: true, instances: false })
    expect(parsePins('{"instances":true}')).toEqual({ targets: false, instances: true })
    expect(parsePins('not json')).toEqual({ targets: false, instances: false })
  })
})
