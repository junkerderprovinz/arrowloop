// Orphaned translation keys. Every table carries the same key set, so a key
// nothing renders is dead in all 42 of them.
//
// The scan reads every .ts/.tsx file except the tables, test files included, so
// a key that some test still names counts as used. Every t(`...${...}...`)
// template contributes a pattern built from its static chunks, so
// t(`schedule.unit.${u}`) covers schedule.unit.<anything> and nothing wider.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { en } from './i18n'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** The phone, which renders half of these keys and none of the other half. */
const MOBILE = resolve(SRC, '..', '..', 'mobile')

/** The files a key must not count as used merely by appearing in, since every key is defined there. */
const TABLES = [
  join(SRC, 'lib', 'i18n.ts'),
  join(SRC, 'lib', 'i18n.data.ts'),
  join(SRC, 'lib', 'locales'),
]

/** Every .ts/.tsx file under a tree, minus the translation tables themselves. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.name === 'node_modules' || e.name === 'android' || e.name === 'build') continue
    if (TABLES.some((t) => p === t || p.startsWith(t + '\\') || p.startsWith(t + '/'))) continue
    if (e.isDirectory()) out.push(...sourceFiles(p))
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(p)
  }
  return out
}

// Both surfaces, since one table serves the browser and the phone.
const CORPUS = [...sourceFiles(SRC), ...sourceFiles(MOBILE)]
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n')

/**
 * The dynamic scan also reads i18n.ts, whose reason renderer builds
 * `reason.${code}`. That is safe because a template has to contain `${`, and
 * no table entry does.
 */
const TEMPLATE_SOURCE = CORPUS + '\n' + readFileSync(join(SRC, 'lib', 'i18n.ts'), 'utf8')

/** The keys each template can produce: t(`a.${x}b`) becomes /^a\..+b$/. */
function dynamicKeyPatterns(corpus: string): RegExp[] {
  const out: RegExp[] = []
  // A key is built either inside t() or ahead of it with a cast, which is how
  // every reason key is reached.
  const templates = [
    ...corpus.matchAll(/\bt\(`([^`]*\$\{[^`]*)`/g),
    ...corpus.matchAll(/`([^`]*\$\{[^`]*)`\s+as\s+TranslationKey/g),
  ]
  for (const m of templates) {
    const chunks = m[1].split(/\$\{[^}]*\}/)
    if (chunks.length < 2) continue
    const body = chunks.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')
    out.push(new RegExp('^' + body + '$'))
  }
  return out
}

const DYNAMIC = dynamicKeyPatterns(TEMPLATE_SOURCE)

describe('translation keys', () => {
  it('finds the app\'s dynamic key templates, so the scan below is not silently blind', () => {
    expect(DYNAMIC.length).toBeGreaterThan(0)
    expect(DYNAMIC.some((r) => r.test('schedule.unit.hour'))).toBe(true)
    expect(DYNAMIC.some((r) => r.test('jobs.cadence.everyOne.week'))).toBe(true)
    // The reason renderer's cast, in the file the usage scan skips.
    expect(DYNAMIC.some((r) => r.test('reason.heldOpen'))).toBe(true)
    // A pattern matches the whole key, so a template's prefix is not excused by it.
    expect(DYNAMIC.some((r) => r.test('jobs.cadence.everyOne'))).toBe(false)
  })

  it('carries no en key that nothing in the tree renders', () => {
    const orphans = Object.keys(en).filter(
      (key) =>
        !CORPUS.includes(`"${key}"`) &&
        !CORPUS.includes(`'${key}'`) &&
        !DYNAMIC.some((r) => r.test(key)),
    )
    expect(
      orphans,
      `these keys are carried by all 42 locale tables and rendered by nothing: ${orphans.join(', ')}. ` +
        `Delete them from web/src/lib/i18n.ts and every file in web/src/lib/locales/.`,
    ).toEqual([])
  })
})
