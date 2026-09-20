// Every language table carries exactly the English key set and the same
// placeholders per value. The tables are typed Partial, so the compiler cannot
// see a missing key.

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
    // The picker shows the language actually running.
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
    // A copy of English passes every check above. Some keys legitimately match,
    // such as technical tokens and borrowed words; most cannot.
    const same = EN_KEYS.filter((k) => table[k as keyof typeof en] === en[k as keyof typeof en])
    expect(
      same.length / EN_KEYS.length,
      `locale "${code}" repeats English for ${same.length} of ${EN_KEYS.length} keys`,
    ).toBeLessThan(0.5)
  })
})
