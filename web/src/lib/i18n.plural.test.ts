import { describe, expect, it } from 'vitest'

import type { TranslationKey } from './i18n'
import { allLocales } from './localesForTests'

const way = (code: string, count: number) =>
  allLocales[code]![`new.way.${new Intl.PluralRules(code).select(count)}` as TranslationKey]?.replace('{count}', String(count))

describe('the way to the changes', () => {
  it('reads as GlimStone words it, in the singular for one', () => {
    expect(way('en', 1)).toBe('This way to 1 change:')
    expect(way('en', 2)).toBe('This way to 2 changes:')
    expect(way('de', 1)).toBe('Hier entlang zu 1 Änderung:')
    expect(way('de', 2)).toBe('Hier entlang zu 2 Änderungen:')
  })

  it('takes the forms of languages with more than two', () => {
    expect([1, 2, 5, 22].map((n) => way('pl', n))).toEqual([
      'Tędy do 1 zmiany:',
      'Tędy do 2 zmian:',
      'Tędy do 5 zmian:',
      'Tędy do 22 zmian:',
    ])
    expect([1, 3, 11].map((n) => way('lt', n))).toEqual(['Čia 1 pakeitimas:', 'Čia 3 pakeitimai:', 'Čia 11 pakeitimų:'])
    expect([1, 2, 20].map((n) => way('ro', n))).toEqual(['Pe aici, 1 modificare:', 'Pe aici, 2 modificări:', 'Pe aici, 20 de modificări:'])
  })

  it('has a sentence with the number for every count in every language', () => {
    for (const code of Object.keys(allLocales)) {
      for (let n = 1; n <= 120; n++) expect(way(code, n), `${code} ${n}`).toContain(String(n))
    }
  })
})
