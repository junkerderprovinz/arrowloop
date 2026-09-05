// The permanent guard on the forty-two language tables.
//
// English is the source of truth. Every other table has to carry exactly the
// English key set, zero missing and zero extra, and every value has to use the
// same placeholder tokens as its English counterpart.
//
// This test exists because neither the compiler nor the build can see the
// problem: the locale tables are typed Partial, so a missing key is legal
// TypeScript and a legal build, and the only symptom is one English sentence in
// the middle of an otherwise translated page. A placeholder that was dropped or
// renamed in translation is worse still: the sentence loses its number, or
// renders a literal brace.

import { describe, expect, it } from 'vitest'

import { de, en, LANGUAGES } from './i18n'
import { allLocales as locales } from './localesForTests'

const EN_KEYS = Object.keys(en).sort()

/** The unique, sorted placeholder tokens in one translated value. */
function placeholders(value: string): string[] {
  return [...new Set(value.match(/\{[a-zA-Z0-9_]+\}/g) ?? [])].sort()
}

describe('the language registry', () => {
  it('is wired to the two inline tables', () => {
    expect(locales.en).toBe(en)
    expect(locales.de).toBe(de)
  })

  it('has exactly one table per offered language', () => {
    expect(Object.keys(locales).sort()).toEqual(LANGUAGES.map((l) => l.code).sort())
  })

  it('offers no entry that resolves rather than names a language', () => {
    // "Automatic" and "System" look like options and are excuses: they fail to
    // answer the only question somebody opens the list to ask.
    for (const l of LANGUAGES) {
      expect(['auto', 'system', 'default']).not.toContain(l.code)
    }
  })
})

describe.each(Object.entries(locales))('locale %s', (code, table) => {
  const keys = Object.keys(table).sort()

  it('carries exactly the English key set', () => {
    const present = new Set(keys)
    const missing = EN_KEYS.filter((k) => !present.has(k))
    const known = new Set(EN_KEYS)
    const extra = keys.filter((k) => !known.has(k))
    expect(
      { missing, extra },
      `locale "${code}" diverges from English: ${missing.length} missing, ${extra.length} extra`,
    ).toEqual({ missing: [], extra: [] })
  })

  it('keeps the placeholders every sentence needs', () => {
    for (const key of EN_KEYS) {
      const value = table[key as keyof typeof en]
      if (value === undefined) continue
      expect(placeholders(value), `locale "${code}", key "${key}"`).toEqual(
        placeholders(en[key as keyof typeof en]),
      )
    }
  })

  it('translates rather than copying English through', () => {
    if (code === 'en') return
    // A table that is a copy of English passes every check above while being no
    // translation at all. Some keys legitimately match: a technical token, or a
    // word a language borrowed whole. Most cannot.
    const same = EN_KEYS.filter((k) => table[k as keyof typeof en] === en[k as keyof typeof en])
    expect(
      same.length / EN_KEYS.length,
      `locale "${code}" repeats English for ${same.length} of ${EN_KEYS.length} keys`,
    ).toBeLessThan(0.5)
  })
})
