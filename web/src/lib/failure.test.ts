import { describe, expect, it } from 'vitest'

import { failureLine, sayFailure } from './failure'
import { de, en, type Translate, type Translations } from './i18n.data'

function tIn(table: Translations): Translate {
  return (key, vars) =>
    Object.entries(vars ?? {}).reduce((said, [name, value]) => said.replaceAll(`{${name}}`, String(value)), table[key])
}

const tooFull =
  'not enough room on the destination: the right side reports 16384 bytes free and this job would write at least 31649416331'
const space = { code: 'notEnoughSpace', params: { side: 'right', free: '16384', needed: '31649416331' } }

describe('a failed run in words', () => {
  it('says why there was no room, with its figures in the language', () => {
    expect(sayFailure(tooFull, space, tIn(de), 'de')).toEqual({
      said: 'Am Ziel (rechts) sind 16 KB frei, dieser Auftrag würde mindestens 29 GB schreiben.',
    })
    expect(sayFailure(tooFull, space, tIn(en), 'en').said).toBe(
      'The destination (right) has 16 KB free, and this job would write at least 29 GB.',
    )
  })

  it('names the side it could not reach', () => {
    const failure = { code: 'unreachable', params: { side: 'left' } }
    expect(sayFailure('left side "nas:photos": connection refused', failure, tIn(de), 'de').said).toBe(
      'Die linke Seite war nicht erreichbar.',
    )
  })

  it('keeps what a command printed under its sentence', () => {
    const failure = { code: 'beforeFailed', params: { output: 'exit status 2' } }
    expect(failureLine('the command before the run failed, so the run did not start: exit status 2', failure, tIn(en), 'en')).toBe(
      'The command before the run failed, so the run did not start. exit status 2',
    )
  })

  it("shows an error it has no words for as the engine's own, under a lead", () => {
    expect(sayFailure('something nobody planned for', undefined, tIn(de), 'de')).toEqual({
      said: 'Meldung des Motors:',
      engine: 'something nobody planned for',
    })
  })

  it("falls back to the engine's words for a kind this version does not know", () => {
    expect(sayFailure('raw', { code: 'fromTheFuture' }, tIn(en), 'en').engine).toBe('raw')
  })
})
