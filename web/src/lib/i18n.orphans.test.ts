// ---------------------------------------------------------------------------
// Orphaned translation keys - the guard that makes a dead key cost something.
//
// A key nobody renders is not free here. The parity test requires all 42 tables
// to carry the SAME key set, so every orphan is 42 dead strings, and every
// locale added later pays to translate it again.
//
// It is ported from the sibling app, which had it first, and it is late: this
// app shipped `jobs.state.detached` for weeks with nothing rendering it, and a
// round that removed one badge from one card turned out to strand three more
// (`jobs.state.waiting`, `jobs.state.settled`, `jobs.neverWorked`) plus a whole
// removed feature's pair (`schedule.reportOnly` and its hint). That is 8 keys,
// 336 dead strings, and every one of them was found by reading rather than by
// anything failing. There is no ratchet list here because that sweep left none
// behind: the list starts empty and has to stay empty.
//
// The scan is deliberately CONSERVATIVE: it reads every .ts/.tsx file under
// src/ except the tables themselves, TEST FILES INCLUDED. A guard that
// false-positives gets switched off, so a key some test still names counts as
// used; the case worth catching is a key with no reference anywhere at all.
//
// Dynamically composed keys are resolved rather than guessed at: every
// t(`...${...}...`) template in the tree contributes a pattern built from its
// static chunks, so t(`schedule.unit.${u}`) marks schedule.unit.<anything> used
// without marking the whole schedule.* namespace used.
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { en } from './i18n'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** The phone, which renders half of these keys and none of the other half. */
const MOBILE = resolve(SRC, '..', '..', 'mobile')

/**
 * The files a key must not count as "used" merely by appearing in.
 *
 * `i18n.data.ts` is the one that matters and it was NOT here, which made this
 * whole guard report green on everything: the tables moved out of `i18n.ts`
 * into their own file so Metro could read them, the exclusion stayed pointing
 * at the old path, and from that moment every key in the app matched itself in
 * the corpus. A dead key cost nothing again, silently, which is precisely the
 * thing this file exists to prevent.
 */
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

// BOTH surfaces. One table serves a browser and a phone, so a key rendered
// only by the phone is not an orphan and a key the phone stopped rendering is.
// Scanning one tree would make this guard wrong in both directions at once.
const CORPUS = [...sourceFiles(SRC), ...sourceFiles(MOBILE)]
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n')

/**
 * The dynamic scan reads one more file than the usage scan does: i18n.ts.
 *
 * The tables are excluded above so that a key cannot count as "used" merely by
 * being defined, and that exclusion took the REASON RENDERER with it. It lives
 * in the same file and builds `reason.${code}` at run time, so on this guard's
 * first run all nineteen reason keys looked dead. Nineteen false positives is
 * the number that gets a guard switched off rather than fixed, which is why
 * this is a fix rather than an allow-list.
 *
 * Including the file here is safe because a template is unambiguous: it has to
 * contain `${`, and no table entry does.
 */
const TEMPLATE_SOURCE = CORPUS + '\n' + readFileSync(join(SRC, 'lib', 'i18n.ts'), 'utf8')

/** t(`a.${x}b`) -> /^a\..+b$/ - the keys that template can actually produce. */
function dynamicKeyPatterns(corpus: string): RegExp[] {
  const out: RegExp[] = []
  // Two shapes, because an app builds a key in two places: at the call site
  // inside t(), and one layer up where an engine code is turned into a key
  // before anything renders it. The second is how every reason string is
  // reached, and it is a cast rather than a call.
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
    // Without this the whole file could pass while matching nothing at all, and
    // a guard that cannot see is worse than no guard: it reports green.
    expect(DYNAMIC.length).toBeGreaterThan(0)
    expect(DYNAMIC.some((r) => r.test('schedule.unit.hour'))).toBe(true)
    expect(DYNAMIC.some((r) => r.test('jobs.cadence.everyOne.week'))).toBe(true)
    // The reason renderer's own shape: a cast rather than a t() call, in the
    // one file the usage scan deliberately skips.
    expect(DYNAMIC.some((r) => r.test('reason.heldOpen'))).toBe(true)
    // ...and a pattern still has to match the WHOLE key, so the prefix a
    // template is built from is not itself excused by it. `schedule.at` is
    // deliberately not the example here: `t(`schedule.${mode}`)` really does
    // reach the whole `schedule.*` namespace, and this scan is conservative on
    // purpose, because a guard that false-positives gets switched off.
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
