import { describe, expect, it } from 'vitest'

import { softHyphen } from './softHyphen'

const SHY = String.fromCharCode(0xad)

describe('softHyphen', () => {
  it('offers a long word one break near its middle, between syllables', () => {
    expect(softHyphen('Benachrichtigungen')).toBe(`Benachrich${SHY}tigungen`)
  })

  it('leaves short words and the spaces between words alone', () => {
    expect(softHyphen('Sync settings')).toBe('Sync settings')
    expect(softHyphen('Notifications')).toBe('Notifications')
  })

  it('leaves a long word without a syllable break near its middle alone', () => {
    expect(softHyphen('aaaaaaaaaaaaaaaa')).toBe('aaaaaaaaaaaaaaaa')
  })
})
