import { describe, expect, it } from 'vitest'

import { speed } from './speed'

// Intl puts a narrow no-break space between number and unit in some locales.
const NO_BREAK = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, 'g')
const spaced = (s: string) => s.replace(NO_BREAK, ' ')

describe('a transfer speed', () => {
  it('reads in the German number format', () => {
    expect(spaced(speed(5_452_595, 'de'))).toBe('5,2 MB/s')
  })

  it('drops the decimal from ten upwards, as a file size does', () => {
    expect(spaced(speed(45 * 1024 * 1024, 'en'))).toBe('45 MB/s')
  })

  it('spells the unit the reader\'s way', () => {
    expect(spaced(speed(2 * 1024 * 1024, 'fr'))).toBe('2,0 Mo/s')
  })

  it('stays in bytes below a kilobyte', () => {
    expect(spaced(speed(512, 'en'))).toBe('512 byte/s')
  })
})
