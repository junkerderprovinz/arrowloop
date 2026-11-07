import { describe, expect, it } from 'vitest'

import { argbToHex, nearestPreset } from './colorMath'

describe('a colour Android hands over', () => {
  it('drops the alpha of an ARGB int, which arrives signed from Kotlin', () => {
    // 0xFF4A6FA5 as a Java int.
    expect(argbToHex(-11898971)).toBe('#4A6FA5')
    expect(argbToHex(0xff4a6fa5)).toBe('#4A6FA5')
    expect(argbToHex(0x00000000)).toBe('#000000')
    expect(argbToHex(-1)).toBe('#FFFFFF')
  })
})

describe('the preset a colour belongs to', () => {
  it('is none for the system mode, which is no colour', () => {
    expect(nearestPreset(['#FCC419', '#1D99F3'], 'system')).toBe(-1)
  })
})
