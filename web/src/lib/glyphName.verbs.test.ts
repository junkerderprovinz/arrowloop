import { describe, expect, it } from 'vitest'

import { en } from './i18n'
import { glyphNameFor } from './glyphName'

/**
 * The mark a button wears has to come from its VERB, not from its namespace.
 *
 * A translation key is `area.verb`, and the rule table is an ordered list of
 * regular expressions over the whole key. That works until an area is named
 * after an action: `edit.save` is the save button on the job editor, and with
 * the `edit` rule sitting above the `save` rule it matched on the namespace and
 * wore a PENCIL. Measured on the phone, beside a target form whose
 * `targets.save` wore the floppy correctly, so the same action carried two
 * marks - which is exactly the collision the table exists to prevent.
 *
 * Nothing could see it. Both keys resolve to a real glyph, both render, both
 * type-check; the only symptom is a save button with the wrong picture on it,
 * on one of the two surfaces, in a set of forty that all look plausible.
 *
 * So this is the guard: for every key whose LAST segment names one of the verbs
 * the table knows, the answer has to be the verb's glyph. It reads the real
 * table through the real function rather than restating the rules, so a future
 * reorder that reintroduces the bug fails here rather than shipping.
 */

/** The verbs whose glyph is decided by the last segment, whatever the area is
 *  called. Deliberately short: these are the ones an area is plausibly NAMED
 *  after, which is the whole way this goes wrong. */
const VERBS: Record<string, string> = {
  save: 'IconSave',
  edit: 'IconEdit',
  copy: 'IconCopy',
  cancel: 'IconCancel',
  remove: 'IconDelete',
  delete: 'IconDelete',
}

describe('the glyph rule table', () => {
  it('decides by the key\'s last segment, not by its namespace', () => {
    const wrong: string[] = []
    for (const key of Object.keys(en)) {
      const last = key.split('.').pop()!.toLowerCase()
      const want = VERBS[last]
      if (!want) continue
      const got = glyphNameFor(key)
      // A key the table answers nothing for is fine: a label with no glyph
      // keeps its word in every mode, which is the designed fallback. What is
      // not fine is answering with somebody else's mark.
      if (got && got !== want) wrong.push(`${key} -> ${got}, wanted ${want}`)
    }
    expect(
      wrong,
      'these keys take their mark from the area they live in rather than from what the button does',
    ).toEqual([])
  })

  it('sees the failure it was written for', () => {
    // The guard above passes trivially if the verb list never matches anything,
    // so this pins the one case that produced it: `edit.save` is a save button
    // living in the edit area, and it has to be the floppy.
    expect(Object.keys(en)).toContain('edit.save')
    expect(glyphNameFor('edit.save')).toBe('IconSave')
  })
})
