import { describe, expect, it } from 'vitest'

import { barDestinations, moreDestinations, onDestination, sidebarDestinations } from './navModel'
import { parsePins } from './navPins'

const none = { targets: false, anomalies: false }
const all = { targets: true, anomalies: true }
const to = (list: { to: string }[]) => list.map((d) => d.to)

describe('the navigation', () => {
  it('puts Anomalies beside Conflicts while the notes are on', () => {
    expect(to(sidebarDestinations({ targets: false, anomalies: true }))).toEqual([
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

  it('adds pinned Targets to the rail before Settings', () => {
    expect(to(sidebarDestinations(all))).toEqual(['/jobs', '/conflicts', '/anomalies', '/trash', '/history', '/targets', '/settings'])
  })

  it('gives the bar four places and the More sheet the rest, pinned or not', () => {
    for (const extras of [{ targets: false, anomalies: true }, all]) {
      expect(to(barDestinations(extras))).toEqual(['/jobs', '/conflicts', '/history', '/settings'])
      expect(to(moreDestinations(extras))).toEqual(['/anomalies', '/trash', '/targets'])
    }
  })

  it('counts a page below a place as that place', () => {
    const [jobs] = sidebarDestinations(none)
    expect(onDestination('/jobs/photos', jobs!)).toBe(true)
    expect(onDestination('/jobsite', jobs!)).toBe(false)
  })

  it('reads stored pins and falls back for anything else', () => {
    expect(parsePins('{"targets":"yes","anomalies":true}')).toEqual({ targets: false })
    expect(parsePins('{"targets":true}')).toEqual({ targets: true })
    expect(parsePins('not json')).toEqual({ targets: false })
  })
})
