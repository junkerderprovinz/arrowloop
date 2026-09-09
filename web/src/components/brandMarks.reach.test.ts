import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every `Mark:` the Go table writes down must arrive at a drawing.
 *
 * The chain has three links in three languages: `internal/remotes/providers.go`
 * names a component, `brandMarks.tsx` maps that name to one, and
 * `brandGlyphs.tsx` exports it. Nothing connects them at compile time - the
 * name travels as a plain string in JSON - and the fallback is silent: a
 * provider whose mark does not resolve simply shows no logo. So a typo in a
 * name, or a Mark set before its component is generated, looks exactly like
 * "this provider has no logo yet", which is a real and common state here.
 *
 * That is the same shape as the missing glyph for `targets.deleteDrive` and the
 * five orphaned translation keys: a break that renders. It needs a test rather
 * than an eye.
 *
 * Both directions are checked. An unreachable mark is a provider missing its
 * logo; an entry in the map that no provider names is dead weight that will
 * still be here long after somebody forgets why.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')

const providersGo = readFileSync(join(repo, 'internal', 'remotes', 'providers.go'), 'utf8')
const marksTsx = readFileSync(join(here, 'brandMarks.tsx'), 'utf8')
// Two drawing files on purpose, and the lookup reaches into both: the brand
// marks are somebody else's logos, the protocol marks are this app's own glyphs
// because there is no company behind "SFTP" to have one.
const glyphsTsx =
  readFileSync(join(here, 'brandGlyphs.tsx'), 'utf8') + readFileSync(join(here, 'glyphs.tsx'), 'utf8')

/** The mark names the Go table hands to the interface. */
const wanted = [...providersGo.matchAll(/Mark:\s*"([^"]+)"/g)].map((m) => m[1])

/** The names the lookup answers to. */
const mapped = [...marksTsx.matchAll(/^ {2}(Icon\w+):\s*\(\)\s*=>/gm)].map((m) => m[1])

describe('brand marks', () => {
  it('has a Go table that names some marks at all', () => {
    // Guards the guard: both lists being empty would make every assertion
    // below pass while proving nothing, which is how a test quietly stops
    // testing after somebody renames a field.
    expect(wanted.length).toBeGreaterThan(20)
    expect(mapped.length).toBeGreaterThan(20)
  })

  it('resolves every mark a provider asks for', () => {
    const missing = wanted.filter((name) => !mapped.includes(name))
    expect(missing, `named in providers.go, absent from brandMarks.tsx: ${missing.join(', ')}`).toEqual([])
  })

  it('draws every mark the lookup answers to', () => {
    const undrawn = mapped.filter((name) => !glyphsTsx.includes(`export function ${name}(`))
    expect(undrawn, `mapped in brandMarks.tsx, not exported by brandGlyphs.tsx: ${undrawn.join(', ')}`).toEqual([])
  })

  it('keeps no mark nobody uses', () => {
    // The protocol marks come from the app's own glyph set through a second
    // lookup in the same file, so only the brand half is checked here.
    const orphans = mapped.filter(
      (name) => !wanted.includes(name) && glyphsTsx.includes(`export function ${name}(`),
    )
    expect(orphans, `mapped and drawn, but no provider names them: ${orphans.join(', ')}`).toEqual([])
  })
})
