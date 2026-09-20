import { describe, expect, it } from 'vitest'

import { en } from './i18n'
import { glyphNameFor } from './glyphName'

/**
 * The mark a button wears comes from its verb, not from its namespace.
 *
 * A key is `area.verb` and the rule table matches the whole key, so an area
 * named after an action can win: `edit.save` would wear the pencil if the edit
 * rule sat above the save rule. Every key whose last segment is a known verb
 * has to get that verb's glyph.
 */

/** The verbs an area is plausibly named after. */
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
      // No glyph is fine, since the label keeps its word; another verb's mark is not.
      if (got && got !== want) wrong.push(`${key} -> ${got}, wanted ${want}`)
    }
    expect(
      wrong,
      'these keys take their mark from the area they live in rather than from what the button does',
    ).toEqual([])
  })

  it('gives the save button in the edit area the save glyph', () => {
    // Keeps the check above from passing because no key matched a verb.
    expect(Object.keys(en)).toContain('edit.save')
    expect(glyphNameFor('edit.save')).toBe('IconSave')
  })
})
