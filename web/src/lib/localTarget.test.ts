import { describe, expect, it } from 'vitest'

import { isLocalTarget, overNetwork } from './localTarget'

const alias = (remote: string) => ({ type: 'alias', settings: [{ key: 'remote', value: remote }] })

describe('isLocalTarget', () => {
  it('counts the local backend and an alias to a folder on this device', () => {
    expect(isLocalTarget({ type: 'local', settings: [] })).toBe(true)
    expect(isLocalTarget(alias('/storage/emulated/0/Sync'))).toBe(true)
    expect(isLocalTarget(alias('D:\\Backups'))).toBe(true)
    expect(isLocalTarget(alias('D:/Backups'))).toBe(true)
  })

  it('counts a cloud, a server and an alias to another target as elsewhere', () => {
    expect(isLocalTarget({ type: 'webdav', settings: [] })).toBe(false)
    expect(isLocalTarget({ type: 'sftp', settings: [] })).toBe(false)
    expect(isLocalTarget(alias('OpenCloud:dokumente'))).toBe(false)
    expect(isLocalTarget(alias(''))).toBe(false)
  })
})

describe('overNetwork', () => {
  const remotes = [
    { name: 'nas', type: 'sftp', settings: [] },
    { name: 'stick', type: 'alias', settings: [{ key: 'remote', value: 'E:\\Backups' }] },
  ]

  it('counts a folder, a drive and a target that is a folder here as this device', () => {
    expect(overNetwork('/srv/photos', remotes)).toBe(false)
    expect(overNetwork('C:\\Users\\me\\Photos', remotes)).toBe(false)
    expect(overNetwork('volume:usb1/photos', remotes)).toBe(false)
    expect(overNetwork('stick:photos', remotes)).toBe(false)
  })

  it('counts a server and a target it does not know as the network', () => {
    expect(overNetwork('nas:photos', remotes)).toBe(true)
    expect(overNetwork('gone:photos', remotes)).toBe(true)
  })
})
