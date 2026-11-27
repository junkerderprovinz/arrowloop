import { describe, expect, it } from 'vitest'

import {
  joinUpstreams,
  joinWrapped,
  splitUpstreams,
  splitWrapped,
  targetChoiceLabel,
  withTargetIds,
} from './wrappedTarget'

const targets = [
  { name: 'My-Disk', label: 'My Disk' },
  { name: 'nas' },
  { name: 'cloud', label: 'Cloud' },
]

describe('the target a wrapper is built on', () => {
  it('reads a target id and a folder on it', () => {
    expect(splitWrapped('nas:photos/2024', targets)).toEqual({ target: 'nas', folder: 'photos/2024' })
    expect(splitWrapped('nas:', targets)).toEqual({ target: 'nas', folder: '' })
  })

  it('takes a target written by its name for the target itself', () => {
    expect(splitWrapped('My Disk:enc', targets)).toEqual({ target: 'My-Disk', folder: 'enc' })
  })

  it('keeps anything else whole as a folder on this machine', () => {
    expect(splitWrapped('/mnt/user/backup', targets)).toEqual({ target: '', folder: '/mnt/user/backup' })
    expect(splitWrapped('C:/Backup', targets)).toEqual({ target: '', folder: 'C:/Backup' })
    expect(splitWrapped('gone:photos', targets)).toEqual({ target: '', folder: 'gone:photos' })
    expect(splitWrapped('', targets)).toEqual({ target: '', folder: '' })
  })

  it('writes the id rclone looks the target up by', () => {
    expect(joinWrapped({ target: 'My-Disk', folder: 'enc' })).toBe('My-Disk:enc')
    expect(joinWrapped({ target: 'nas', folder: '' })).toBe('nas:')
    expect(joinWrapped({ target: '', folder: '/mnt/user/backup' })).toBe('/mnt/user/backup')
  })

  it('trims what was typed around the folder', () => {
    expect(joinWrapped({ target: 'nas', folder: ' photos ' })).toBe('nas:photos')
  })

  it('names a target by its label with the id beside it where the two differ', () => {
    expect(targetChoiceLabel({ name: 'My-Disk', label: 'My Disk' })).toBe('My Disk (My-Disk)')
    expect(targetChoiceLabel({ name: 'nas' })).toBe('nas')
    expect(targetChoiceLabel({ name: 'nas', label: 'nas' })).toBe('nas')
  })
})

describe('the targets a union or combine joins', () => {
  it('reads a list of targets with their folders', () => {
    expect(splitUpstreams('nas:photos cloud:', targets, false)).toEqual([
      { target: 'nas', folder: 'photos', mode: '' },
      { target: 'cloud', folder: '', mode: '' },
    ])
  })

  it('keeps a union upstream\'s mode apart from its folder', () => {
    expect(splitUpstreams('nas:photos:ro cloud::writeback', targets, false)).toEqual([
      { target: 'nas', folder: 'photos', mode: ':ro' },
      { target: 'cloud', folder: '', mode: ':writeback' },
    ])
  })

  it('reads a quoted entry with spaces in it as one', () => {
    expect(splitUpstreams('"nas:my photos" cloud:', targets, false)).toEqual([
      { target: 'nas', folder: 'my photos', mode: '' },
      { target: 'cloud', folder: '', mode: '' },
    ])
  })

  it('skips the empty entries extra spaces leave', () => {
    expect(splitUpstreams('  nas:a   cloud:b ', targets, false)).toHaveLength(2)
  })

  it('reads the folder name each combined target appears under', () => {
    expect(splitUpstreams('photos=nas:photos "My Music=cloud:music"', targets, true)).toEqual([
      { dir: 'photos', target: 'nas', folder: 'photos', mode: '' },
      { dir: 'My Music', target: 'cloud', folder: 'music', mode: '' },
    ])
  })

  it('writes the list back the way rclone reads it', () => {
    const union = '"nas:my photos" cloud::ro /mnt/disk1'
    expect(joinUpstreams(splitUpstreams(union, targets, false), false)).toBe(union)
    const combine = 'photos=nas:photos "My Music=cloud:music"'
    expect(joinUpstreams(splitUpstreams(combine, targets, true), true)).toBe(combine)
  })

  it('writes a target typed by its name under its id', () => {
    expect(joinUpstreams(splitUpstreams('"My Disk:a"', targets, false), false)).toBe('My-Disk:a')
  })

  it('leaves out a row with neither target nor folder', () => {
    expect(joinUpstreams([{ target: '', folder: ' ', mode: '' }, { target: 'nas', folder: '', mode: '' }], false)).toBe(
      'nas:',
    )
  })

  it('quotes a quote inside an entry by doubling it', () => {
    expect(joinUpstreams([{ target: 'nas', folder: 'say "hi"', mode: '' }], false)).toBe('"nas:say ""hi"""')
    expect(splitUpstreams('"nas:say ""hi"""', targets, false)).toEqual([
      { target: 'nas', folder: 'say "hi"', mode: '' },
    ])
  })
})

describe('a saved form opened again', () => {
  it('starts with every target written by its id', () => {
    expect(withTargetIds({ remote: 'My Disk:enc', password: 'x' }, targets, false)).toEqual({
      remote: 'My-Disk:enc',
      password: 'x',
    })
    expect(withTargetIds({ upstreams: '"Cloud:a b" nas:' }, targets, false)).toEqual({
      upstreams: '"cloud:a b" nas:',
    })
  })

  it('leaves a form without these settings as it is', () => {
    const values = { host: 'nas' }
    expect(withTargetIds(values, targets, false)).toEqual(values)
  })
})
