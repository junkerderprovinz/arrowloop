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

/**
 * The verbs an area is plausibly named after. Removing a password or a passkey
 * revokes a key, and removing two-factor authentication turns a protection off.
 */
const VERBS: Record<string, string[]> = {
  save: ['IconSave'],
  edit: ['IconPencil'],
  copy: ['IconCopy'],
  cancel: ['IconClose'],
  remove: ['IconTrash', 'IconKeyRevoke', 'IconShieldOff'],
  delete: ['IconTrash'],
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
      if (got && !want.includes(got)) wrong.push(`${key} -> ${got}, wanted ${want.join(' or ')}`)
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

describe('a meaning with a glyph of its own in GlimStone', () => {
  it.each([
    ['look.accentReset', 'IconRefresh'],
    ['backup.import', 'IconImport'],
    ['backup.export', 'IconExport'],
    ['reset.done', 'IconConfirm'],
    ['twoFactor.confirm', 'IconConfirm'],
    ['pick.choose', 'IconApply'],
    ['notify.test', 'IconSendTest'],
    ['conflict.answerBoth', 'IconKeepBoth'],
    ['conflicts.allLeft', 'IconKeepLeft'],
    ['conflict.answerRight', 'IconKeepRight'],
    ['login.submit', 'IconSignIn'],
    ['login.passkeyUnlock', 'IconKey'],
    ['reset.link', 'IconForgotPassword'],
    ['about.checkUpdates', 'IconUpdate'],
    ['about.upToDate', 'IconUpToDate'],
    ['about.updatesFound', 'IconUpdateAvailable'],
    ['tray.open', 'IconApp'],
  ])('wears it on %s', (key, glyph) => {
    expect(glyphNameFor(key)).toBe(glyph)
  })
})
