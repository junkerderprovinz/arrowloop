import { describe, expect, it } from 'vitest'

import { phoneFolder, remoteOf } from './side.data'

describe('remoteOf', () => {
  it('reads the target before the colon', () => {
    expect(remoteOf('gdrive:Photos')).toBe('gdrive')
  })

  it('leaves a colon after a slash in the path', () => {
    expect(remoteOf('/storage/emulated/0/a:b')).toBeUndefined()
  })
})

describe('phoneFolder', () => {
  const targets = ['gdrive', 'nas']

  it('keeps a folder on the phone', () => {
    expect(phoneFolder('/storage/emulated/0/DCIM', targets)).toEqual({ side: '/storage/emulated/0/DCIM' })
  })

  it('moves the side to a target named in front', () => {
    expect(phoneFolder('nas:backup', targets)).toEqual({ side: 'nas:backup' })
  })

  it.each(['C:/Program', 'C:\\Program Files', 'D:'])('refuses %s, a drive that is no target', (typed) => {
    expect(phoneFolder(typed, targets)).toEqual({ stray: typed[0] })
  })

  it('refuses a mistyped target name', () => {
    expect(phoneFolder('gdriv:Photos', targets)).toEqual({ stray: 'gdriv' })
  })

  it('lets the field be emptied', () => {
    expect(phoneFolder('', targets)).toEqual({ side: '' })
  })
})
