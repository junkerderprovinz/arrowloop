// Badges are written in sentence case in every language that has capitals, on
// the web and on the phone alike, so a list never mixes "running" with
// "Stopped".
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TranslationKey } from './i18n'
import { allLocales } from './localesForTests'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MOBILE = resolve(SRC, '..', '..', 'mobile', 'src')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'locales' && e.name !== 'fortressLocales') out.push(...sourceFiles(p))
    } else if (e.name.endsWith('.tsx') && !e.name.includes('.test.')) {
      out.push(p)
    }
  }
  return out
}

/** Every key a badge is labelled with: `<Badge label={t("x")}` on the phone, `<Badge>{t('x')}` on the web. */
function badgeKeys(): TranslationKey[] {
  const keys = new Set<string>()
  for (const file of [...sourceFiles(SRC), ...sourceFiles(MOBILE)]) {
    const code = readFileSync(file, 'utf8')
    for (const m of code.matchAll(/<Badge\b[^>]*?label=\{t\("([^"]+)"/g)) keys.add(m[1])
    for (const m of code.matchAll(/<Badge\b[^>]*>\s*\{t\('([^']+)'/g)) keys.add(m[1])
  }
  return [...keys].sort() as TranslationKey[]
}

const KEYS = badgeKeys()

describe('badge labels', () => {
  it('are found on both surfaces, so the check below is not blind', () => {
    expect(KEYS).toContain('status.stopped')
    expect(KEYS).toContain('status.paused')
    expect(KEYS).toContain('targets.checkOk')
  })

  it.each(Object.entries(allLocales))('start with a capital in %s', (lang, table) => {
    const lower = KEYS.filter((key) => {
      const first = [...(table[key] ?? '')][0] ?? ''
      return first !== first.toLocaleUpperCase(lang)
    })
    expect(lower.map((key) => `${key}: ${table[key]}`)).toEqual([])
  })
})
