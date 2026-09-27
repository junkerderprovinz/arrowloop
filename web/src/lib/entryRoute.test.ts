import { describe, expect, it } from 'vitest'

import { entryRoute } from './entryLabel'

const job = { name: 'photos', left: 'D:\\Fotos', right: 'OpenCloud:bilder' }
const drives = [{ id: 'abc', label: 'Backup' }]

describe('entryRoute', () => {
  it('takes a copy from the other side to the side written to', () => {
    expect(entryRoute({ Kind: 'copy', Side: 'right', Path: 'urlaub/a.jpg' }, job, drives)).toEqual({
      from: 'D:\\Fotos\\urlaub\\a.jpg',
      to: 'OpenCloud:bilder/urlaub/a.jpg',
    })
    expect(entryRoute({ Kind: 'copy', Side: 'left', Path: 'urlaub/a.jpg' }, job, drives)).toEqual({
      from: 'OpenCloud:bilder/urlaub/a.jpg',
      to: 'D:\\Fotos\\urlaub\\a.jpg',
    })
  })

  it('takes a rename from its old name to its new one on the same side', () => {
    expect(entryRoute({ Kind: 'move', Side: 'left', Path: 'urlaub/a.jpg', Note: 'urlaub/b.jpg' }, job, drives)).toEqual({
      from: 'D:\\Fotos\\urlaub\\b.jpg',
      to: 'D:\\Fotos\\urlaub\\a.jpg',
    })
  })

  it('takes a file that left for the other side from the side named', () => {
    expect(entryRoute({ Kind: 'move', Side: 'left', Path: 'a.jpg', Note: 'relocated' }, job, drives)).toEqual({
      from: 'D:\\Fotos\\a.jpg',
      to: 'OpenCloud:bilder/a.jpg',
    })
  })

  it('gives a change in one place only where it happened', () => {
    expect(entryRoute({ Kind: 'trash', Side: 'right', Path: 'a.jpg', Note: 'bin' }, job, drives)).toEqual({
      to: 'OpenCloud:bilder/a.jpg',
    })
  })

  it('names both copies of a conflict', () => {
    expect(entryRoute({ Kind: 'conflict', Side: '', Path: 'a.txt', Note: 'keep both' }, job, drives)).toEqual({
      from: 'D:\\Fotos\\a.txt',
      to: 'OpenCloud:bilder/a.txt',
      both: true,
    })
  })

  it('writes each side the way it writes paths', () => {
    const phone = { name: 'p', left: '/storage/emulated/0/DCIM', right: 'OpenCloud:' }
    expect(entryRoute({ Kind: 'copy', Side: 'right', Path: 'a.jpg' }, phone, drives)).toEqual({
      from: '/storage/emulated/0/DCIM/a.jpg',
      to: 'OpenCloud:a.jpg',
    })
    const drive = { name: 'd', left: 'volume:abc/Fotos', right: 'D:\\' }
    expect(entryRoute({ Kind: 'copy', Side: 'right', Path: 'a.jpg' }, drive, drives)).toEqual({
      from: 'Backup/Fotos/a.jpg',
      to: 'D:\\a.jpg',
    })
  })

  it('has nothing to say without the job', () => {
    expect(entryRoute({ Kind: 'copy', Side: 'right', Path: 'a.jpg' }, undefined, drives)).toBeNull()
  })
})
