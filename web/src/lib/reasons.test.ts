import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { en, type TranslationKey } from './i18n.data'
import { allLocales } from './localesForTests'
import { reasonText } from './reasonText'

// One table serves the browser and the phone, so a code missing here is
// missing on both.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const source = (file: string) => readFileSync(join(ROOT, file), 'utf8')

/** The codes and English templates of internal/plan's reasonText. */
function engineReasons(): Record<string, string> {
  const table = source('internal/plan/plan.go').match(/var reasonText = map\[string\]string\{([\s\S]*?)\n\}/)
  if (!table) throw new Error('no reasonText in internal/plan/plan.go')
  return Object.fromEntries([...table[1].matchAll(/"(\w+)":\s+"((?:[^"\\]|\\.)*)"/g)].map((m) => [m[1], m[2]]))
}

/** The values a Go function hands back as plain string literals. */
function returned(file: string, func: string): string[] {
  const body = source(file).match(new RegExp(`func ${func}[^\\n]*\\{([\\s\\S]*?)\\n\\}`))
  if (!body) throw new Error(`no ${func} in ${file}`)
  return [...body[1].matchAll(/return "([^"]+)"/g)].map((m) => m[1])
}

const placeholders = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort()

const reasons = engineReasons()

describe('the reasons the engine gives', () => {
  it('are read from the engine', () => {
    expect(Object.keys(reasons).length).toBeGreaterThan(30)
  })

  it.each(Object.entries(reasons))('%s has a sentence with the engine\'s placeholders in every language', (code, text) => {
    const key = `reason.${code}` as TranslationKey
    expect(en[key], `missing ${key}`).toBeDefined()
    expect(placeholders(en[key])).toEqual(placeholders(text))
    for (const [lang, table] of Object.entries(allLocales)) {
      expect(table[key], `${lang} has no ${key}`).toBeTruthy()
    }
  })
})

/** A translate function over one table, falling back like the surfaces do. */
function translator(table: Partial<Record<TranslationKey, string>>) {
  return (key: TranslationKey, vars?: Record<string, string | number>) =>
    (table[key] ?? en[key] ?? key).replace(/\{(\w+)\}/g, (whole, name: string) => (vars && name in vars ? String(vars[name]) : whole))
}

const spell = (lang: string) => ({ lang, moment: (iso: string) => iso })

describe('the words the engine writes into a reason', () => {
  // internal/apply's whyFailed is told the step as a plan kind or a word of its own.
  const steps = [
    ...returned('internal/plan/plan.go', '\\(k Kind\\) String'),
    ...returned('internal/plan/plan.go', '\\(k DirKind\\) String'),
    ...[...source('internal/apply/apply.go').matchAll(/whyFailed\([^,]+, [^,]+, "([^"]+)"/g)].map((m) => m[1]),
  ]
  const kinds = returned('internal/scan/unsupported.go', 'unsupportedKind')

  it('are read from the engine', () => {
    expect(steps).toContain('copy')
    expect(steps).toContain('removing the folder')
    expect(kinds).toContain('symbolic link')
  })

  // Passed through unchanged, the engine's English word would sit in the sentence.
  it.each(Object.entries(allLocales).filter(([lang]) => lang !== 'en'))('are all worded in %s', (lang, table) => {
    const t = translator(table)
    const side = t('side.left')
    for (const what of new Set(steps)) {
      const said = reasonText(t, { code: 'stepFailed', vars: { what, error: 'E' }, text: '' }, spell(lang))
      expect(said, `${lang} leaves the step "${what}" in English`).not.toBe(t('reason.stepFailed', { what, error: 'E' }))
    }
    for (const kind of kinds) {
      const said = reasonText(t, { code: 'unsupported', vars: { kind, side: 'left' }, text: '' }, spell(lang))
      expect(said, `${lang} leaves "${kind}" in English`).not.toBe(t('reason.unsupported', { kind, side }))
    }
  })
})
