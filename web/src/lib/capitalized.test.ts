import { describe, expect, it } from 'vitest'

import { capitalized } from './capitalized'

describe('capitalized', () => {
  it('raises the first letter of a run count for a badge', () => {
    expect(capitalized('conflicts: 2', 'en')).toBe('Conflicts: 2')
    expect(capitalized('конфліктів: 2', 'uk')).toBe('Конфліктів: 2')
  })

  it('raises it the way the language does', () => {
    expect(capitalized('işler', 'tr')).toBe('İşler')
  })

  it('leaves a script without capitals as it is', () => {
    expect(capitalized('競合: 2', 'ja')).toBe('競合: 2')
  })
})
