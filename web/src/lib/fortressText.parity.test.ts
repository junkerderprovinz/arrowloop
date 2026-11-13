import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { FORTRESS_LANGUAGES, fortressText, joinRefusalText, type FortressText } from '@glimstone/core'
import { describe, expect, it } from 'vitest'

/**
 * The phone carries the fortress's words by hand, since Metro bundles no
 * package of the browser's. Each language has to say what GlimStone says, or
 * the phone words a removal or a refused join differently from the web.
 */

const CODES = ['phrase', 'closedUntilNewPhrase', 'busy']

type Phone = { languages: string[]; texts: Record<string, FortressText>; refusals: Record<string, string> }

/**
 * What the phone's copy says, loaded by Node itself: the phone's files belong
 * to Expo's TypeScript setup, which Vite cannot read without the phone's
 * packages.
 */
function phone(): Phone {
  const at = (file: string) => JSON.stringify(new URL(`../../../mobile/src/glimstone/${file}`, import.meta.url).href)
  const script = `
    const { FORTRESS_LANGUAGES, fortressText } = await import(${at('fortressTexts.ts')})
    const { joinRefusalText } = await import(${at('joinRefusal.ts')})
    const en = fortressText('en')
    process.stdout.write(JSON.stringify({
      languages: FORTRESS_LANGUAGES,
      texts: Object.fromEntries(FORTRESS_LANGUAGES.map((lang) => [lang, fortressText(lang)])),
      refusals: Object.fromEntries(${JSON.stringify(CODES)}.map((code) => [code, joinRefusalText(en, code)])),
    }))
  `
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })) as Phone
}

describe("the phone's fortress words", () => {
  const copy = phone()

  it('match GlimStone in every language', () => {
    expect(copy.languages).toEqual(FORTRESS_LANGUAGES)
    for (const lang of FORTRESS_LANGUAGES) expect(copy.texts[lang], lang).toEqual(fortressText(lang))
  })

  it('word a refused join as GlimStone does', () => {
    const en = fortressText('en')
    for (const code of CODES) expect(copy.refusals[code], code).toBe(joinRefusalText(en, code))
    expect(copy.refusals.closedUntilNewPhrase).toBe(en.joinLocked)
  })

  it('say on the Pairing screen that a join after a removal waits for the new phrase', () => {
    const screen = readFileSync(new URL('../../../mobile/src/screens/Pairing.tsx', import.meta.url), 'utf8')
    const join = screen.slice(screen.indexOf('async function join('), screen.indexOf('const flip ='))
    expect(join).toMatch(/e\.code === "closedUntilNewPhrase"\) return joinRefusalText\(text, e\.code\)/)
  })
})
