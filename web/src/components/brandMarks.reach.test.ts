import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Every `Mark:` in internal/remotes/providers.go must reach a drawing through
// brandMarks.tsx. The name travels as a plain string and an unresolved mark
// silently shows no logo, so nothing but this test connects the three files.

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')

const providersGo = readFileSync(join(repo, 'internal', 'remotes', 'providers.go'), 'utf8')
const marksTsx = readFileSync(join(here, 'brandMarks.tsx'), 'utf8')
// Brand marks come from brandGlyphs.tsx, protocol marks from the app's glyphs.
const glyphsTsx =
  readFileSync(join(here, 'brandGlyphs.tsx'), 'utf8') + readFileSync(join(here, 'glyphs.tsx'), 'utf8')

/** The mark names the Go table hands to the interface. */
const wanted = [...providersGo.matchAll(/Mark:\s*"([^"]+)"/g)].map((m) => m[1])

/** The names the lookup answers to. */
const mapped = [...marksTsx.matchAll(/^ {2}(Icon\w+):\s*\(\)\s*=>/gm)].map((m) => m[1])

describe('brand marks', () => {
  it('has a Go table that names some marks at all', () => {
    // Empty lists would let every assertion below pass without proving anything.
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
    // Only the brand half: protocol marks are the app's own glyphs.
    const orphans = mapped.filter(
      (name) => !wanted.includes(name) && glyphsTsx.includes(`export function ${name}(`),
    )
    expect(orphans, `mapped and drawn, but no provider names them: ${orphans.join(', ')}`).toEqual([])
  })
})
