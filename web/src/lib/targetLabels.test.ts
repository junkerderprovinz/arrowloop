import { afterEach, describe, expect, it } from 'vitest'

import { labelledSide, learnTargets } from './targetLabels'

afterEach(() => learnTargets([]))

describe('a side as a person reads it', () => {
  it('names a target by its label in front of the folder', () => {
    learnTargets([{ name: 'SFTP-Home-Lab', label: 'Home Lab - Keller' }])
    expect(labelledSide('SFTP-Home-Lab:home/a')).toBe('Home Lab - Keller: home/a')
    expect(labelledSide('SFTP-Home-Lab:')).toBe('Home Lab - Keller')
  })

  it('names a target without a label by its id', () => {
    expect(labelledSide('OneDriveB:Documents')).toBe('OneDriveB: Documents')
  })

  it('leaves a folder on the device and a drive as written', () => {
    expect(labelledSide('/storage/emulated/0/DCIM')).toBe('/storage/emulated/0/DCIM')
    expect(labelledSide('C:\Users\Fotos')).toBe('C:\Users\Fotos')
    expect(labelledSide('volume:a1b2/Fotos')).toBe('volume:a1b2/Fotos')
  })
})
