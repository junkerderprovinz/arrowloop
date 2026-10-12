import { describe, expect, it } from 'vitest'

import { barDestinations, moreDestinations, onDestination, sidebarDestinations } from './navModel'
import { parsePins } from './navPins'

const none = { targets: false, anomalies: false }
const to = (list: { to: string }[]) => list.map((d) => d.to)

describe('the navigation', () => {
  it('puts Jobs, Conflicts, Trash and History in the rail, Settings at its foot', () => {
    expect(to(sidebarDestinations(none))).toEqual(['/jobs', '/conflicts', '/trash', '/history', '/settings'])
  })

  it('adds a pinned page to the rail before Settings', () => {
    expect(to(sidebarDestinations({ targets: true, anomalies: true }))).toEqual([
      '/jobs',
      '/conflicts',
      '/trash',
      '/history',
      '/targets',
      '/anomalies',
      '/settings',
    ])
  })

  it('gives the bar four places and the More sheet the rest, pinned or not', () => {
    for (const pins of [none, { targets: true, anomalies: true }]) {
      expect(to(barDestinations(pins))).toEqual(['/jobs', '/conflicts', '/history', '/settings'])
      expect(to(moreDestinations(pins))).toEqual(['/trash', '/targets', '/anomalies'])
    }
  })

  it('counts a page below a place as that place', () => {
    const [jobs] = sidebarDestinations(none)
    expect(onDestination('/jobs/photos', jobs!)).toBe(true)
    expect(onDestination('/jobsite', jobs!)).toBe(false)
  })

  it('reads stored pins and falls back for anything else', () => {
    expect(parsePins('{"targets":true,"anomalies":"yes"}')).toEqual({ targets: true, anomalies: false })
    expect(parsePins('not json')).toEqual(none)
  })
})
