import { describe, expect, it } from 'vitest'

import { entryNote } from './entryLabel'
import { de, en, type TranslationKey } from './i18n.data'
import ja from './locales/ja'
import zh from './locales/zh'
import { exactMoment, reasonText } from './reasonText'

/** Translates the way the page does: the language, then English, then the key itself. */
function translator(table: Partial<Record<TranslationKey, string>>) {
  return (key: TranslationKey, vars?: Record<string, string | number>) =>
    (table[key] ?? en[key] ?? key).replace(/\{(\w+)\}/g, (whole, name: string) => (vars && name in vars ? String(vars[name]) : whole))
}

const english = translator(en)
const german = translator(de)
const spell = (lang: string) => ({ lang, moment: (iso: string) => `[${iso}]` })

const grew = {
  code: 'inFlux',
  vars: { side: 'left', runs: '3', details: 'While it was read its size changed from 4 to 9 bytes.', sizeFrom: '4', sizeTo: '9' },
  text: 'The file was being written on the left while it was copied, in 3 runs in a row. It waits for the next run. While it was read its size changed from 4 to 9 bytes.',
}

const differs = {
  code: 'inFlux',
  vars: {
    side: 'right',
    runs: '12',
    details: 'After the copy the size is 1048576 bytes on the left and 1040000 on the right, the modification time is 2026-11-19 10:00:00 UTC on the left and 2026-11-20 08:16:40 UTC on the right.',
    leftSize: '1048576',
    rightSize: '1040000',
    leftTime: '2026-11-19T10:00:00Z',
    rightTime: '2026-11-20T08:16:40Z',
  },
  text: 'The file was being written on the right while it was copied, in 12 runs in a row. It waits for the next run. After the copy the size is 1048576 bytes on the left and 1040000 on the right, the modification time is 2026-11-19 10:00:00 UTC on the left and 2026-11-20 08:16:40 UTC on the right.',
}

describe('a reason in the reader\'s language', () => {
  it('is worded from its code, with the side in that language', () => {
    expect(reasonText(german, { code: 'heldOpen', vars: { side: 'left' }, text: '' }, spell('de'))).toBe(
      'Ein anderes Programm hält die Datei links offen. ArrowLoop wartet, bis sie geschlossen wird.',
    )
  })

  it('names the step that failed in that language and keeps the backend\'s words', () => {
    const failed = { code: 'stepFailed', vars: { what: 'copy', error: 'no space left on device' }, text: '' }
    expect(reasonText(german, failed, spell('de'))).toBe(
      'Das Kopieren ist fehlgeschlagen: no space left on device. Der nächste Lauf versucht es noch einmal.',
    )
    expect(reasonText(english, failed, spell('en'))).toBe('The copy failed: no space left on device. The next run tries again.')
  })

  it('gives a waiting period in the units of the language', () => {
    const settling = { code: 'settling', vars: { side: 'right', period: '5s', seconds: '5' }, text: '' }
    expect(reasonText(german, settling, spell('de'))).toBe(
      'Die Datei wurde vor weniger als 5 s rechts geändert. ArrowLoop wartet, bis sie zur Ruhe kommt.',
    )
  })

  it('keeps the engine\'s sentence for a code this build does not know', () => {
    const newer = { code: 'somethingNewer', vars: { side: 'left' }, text: 'a reason from a newer engine' }
    expect(reasonText(german, newer, spell('de'))).toBe('a reason from a newer engine')
  })
})

describe('a reason with a word put into it', () => {
  const japanese = translator(ja)
  const chinese = translator(zh)

  it('joins the word without spaces in Japanese and Chinese', () => {
    const pipe = { code: 'unsupported', vars: { kind: 'named pipe', side: 'left' }, text: '' }
    expect(reasonText(japanese, pipe, spell('ja'))).toBe('左側にある名前付きパイプは、このエンジンでは運べません。')
    expect(reasonText(chinese, pipe, spell('zh'))).toBe('左侧有一个命名管道，这个引擎不带它走。')
  })

  it('opens with a capital where the sentence starts with the word', () => {
    const pipe = { code: 'unsupported', vars: { kind: 'named pipe', side: 'left' }, text: '' }
    expect(reasonText(german, pipe, spell('de'))).toBe('Links liegt eine benannte Pipe. So etwas nimmt dieser Dienst nicht mit.')
  })
})

describe('a file written to while it was copied', () => {
  it('says how it grew while it was read, in each language', () => {
    expect(reasonText(english, grew, spell('en'))).toBe(
      'The file was being written on the left while it was copied, in 3 runs in a row. It waits for the next run. While it was read its size changed from 4 to 9 bytes.',
    )
    expect(reasonText(german, grew, spell('de'))).toBe(
      'Die Datei wurde links während des Kopierens beschrieben, schon 3 Läufe hintereinander. Sie bleibt für den nächsten Lauf liegen. Beim Lesen änderte sich die Größe von 4 auf 9 Byte.',
    )
  })

  it('says what the two sides read differently, with numbers and times written the language\'s way', () => {
    expect(reasonText(english, differs, spell('en'))).toBe(
      'The file was being written on the right while it was copied, in 12 runs in a row. It waits for the next run. ' +
        'After the copy the size is 1,048,576 bytes on the left and 1,040,000 on the right. ' +
        'After the copy the modification time is [2026-11-19T10:00:00Z] on the left and [2026-11-20T08:16:40Z] on the right.',
    )
    expect(reasonText(german, differs, spell('de'))).toBe(
      'Die Datei wurde rechts während des Kopierens beschrieben, schon 12 Läufe hintereinander. Sie bleibt für den nächsten Lauf liegen. ' +
        'Nach dem Kopieren ist die Datei links 1.048.576 Byte groß und rechts 1.040.000. ' +
        'Nach dem Kopieren ist die Änderungszeit links [2026-11-19T10:00:00Z] und rechts [2026-11-20T08:16:40Z].',
    )
  })

  it('keeps the error\'s own words where the engine could tell nothing more', () => {
    const said = { ...grew, vars: { side: 'left', runs: '3', details: 'source file is being updated' } }
    expect(reasonText(german, said, spell('de'))).toMatch(/liegen\. source file is being updated$/)
  })
})

describe('the note beside an entry', () => {
  it('words an entry that carries its code in the reader\'s language', () => {
    const e = { Kind: 'skip', Side: '', Path: 'app.log', Note: grew.text, Code: grew.code, Vars: grew.vars }
    expect(entryNote(german, e, spell('de'))).toBe(reasonText(german, grew, spell('de')))
  })

  it('shows the English note of an entry recorded before codes were kept', () => {
    const e = { Kind: 'skip', Side: '', Path: 'big.iso', Note: 'copy failed, leaving it for the next run: permission denied' }
    expect(entryNote(german, e, spell('de'))).toBe('copy failed, leaving it for the next run: permission denied')
  })

  it('shows the English note of an entry whose code this build does not know', () => {
    const e = { Kind: 'skip', Side: '', Path: 'a.txt', Note: 'a reason from a newer engine', Code: 'somethingNewer' }
    expect(entryNote(german, e, spell('de'))).toBe('a reason from a newer engine')
  })
})

describe('a moment a file is compared by', () => {
  it('is given to the second, and to the millisecond where it has a fraction', () => {
    const utc = { timeZone: 'UTC' }
    expect(exactMoment('2026-11-20T08:15:07Z', 'de', utc)).toBe('20.11.2026, 08:15:07')
    expect(exactMoment('2026-11-20T08:15:02.5Z', 'de', utc)).toBe('20.11.2026, 08:15:02,500')
  })
})
