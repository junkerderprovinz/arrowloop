import { describe, expect, it } from 'vitest'

import { releaseNotice } from './releaseNotice'

describe('the notice of a newer release', () => {
  it('names the version a container found and links its release notes', () => {
    expect(releaseNotice({ deployment: 'container', newRelease: 'v2.7.0' }, null)).toEqual({
      tag: 'v2.7.0',
      version: '2.7.0',
      notes: 'https://github.com/junkerderprovinz/arrowloop/releases/tag/v2.7.0',
    })
  })

  it('stays away while no newer release is known', () => {
    expect(releaseNotice({ deployment: 'container' }, null)).toBeNull()
    expect(releaseNotice(null, null)).toBeNull()
  })

  it('is only for a container, since the other builds update another way', () => {
    for (const deployment of ['desktop', 'phone', 'server', undefined]) {
      expect(releaseNotice({ deployment, newRelease: 'v2.7.0' }, null)).toBeNull()
    }
  })

  it('stays hidden for the version it was hidden for', () => {
    expect(releaseNotice({ deployment: 'container', newRelease: 'v2.7.0' }, 'v2.7.0')).toBeNull()
  })

  it('comes back for the next release after one was hidden', () => {
    expect(releaseNotice({ deployment: 'container', newRelease: 'v2.8.0' }, 'v2.7.0')?.version).toBe('2.8.0')
  })
})
