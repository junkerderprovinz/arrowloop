import { describe, expect, it } from 'vitest'

import { isLocalTarget } from './localTarget'

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
