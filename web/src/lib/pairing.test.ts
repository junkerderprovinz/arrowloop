import { describe, expect, it } from 'vitest'

import { ApiError } from './api'
import { en, type TranslationKey } from './i18n.data'
import { kindName, pairStage, refusalText, seenAgo } from './pairing'

const t = (key: TranslationKey, vars?: Record<string, string | number>) =>
  en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? `{${name}}`))

const member = { id: 'b'.repeat(40), name: 'Cellar', deployment: 'server' as const, approved: true }

describe('where an instance stands in its group', () => {
  it('is unpaired outside a group', () => {
    expect(pairStage({ active: false, members: [], memberSeen: false }, 0, false)).toBe('unpaired')
  })

  it('tells a group this page started from one it entered', () => {
    expect(pairStage({ active: true, members: [], memberSeen: false }, 5, true)).toBe('new')
    expect(pairStage({ active: true, members: [], memberSeen: false }, 5, false)).toBe('searching')
  })

  it('is alone once nobody came for a minute', () => {
    expect(pairStage({ active: true, members: [], memberSeen: false }, 60, true)).toBe('alone')
  })

  it('is paired while another instance is there, and gone once all of them left', () => {
    expect(pairStage({ active: true, members: [member], memberSeen: true }, 600, false)).toBe('paired')
    expect(pairStage({ active: true, members: [], memberSeen: true }, 600, false)).toBe('gone')
  })
})

describe('a refused phrase', () => {
  it('names the word that is not on the list and where it stands', () => {
    const e = new ApiError('x', 400, 'unknown_word', { word: 'zzzz', position: '5', count: '0' })
    expect(refusalText(t, e)).toBe('Word 5 ("zzzz") is not on the word list.')
  })

  it('counts the words of a phrase that is too long or too short', () => {
    expect(refusalText(t, new ApiError('x', 400, 'word_count', { count: '11' }))).toContain('11')
  })

  it('says when the words do not belong together', () => {
    expect(refusalText(t, new ApiError('x', 400, 'checksum'))).toBe(en['pairing.errChecksum'])
  })

  it('reads a wrong password as one', () => {
    expect(refusalText(t, new ApiError('the current password is not right', 403))).toBe(en['login.wrong'])
  })
})

describe('the names of the kinds', () => {
  it('names every kind an instance announces and nothing else', () => {
    expect(kindName(t, 'phone')).toBe('Phone app')
    expect(kindName(t, 'robot')).toBe('')
  })
})

describe('when an instance was last seen', () => {
  it('reads as a time ago in the reader language', () => {
    const now = Date.UTC(2026, 10, 7, 12, 0, 0)
    expect(seenAgo('en', now / 1000 - 300, now)).toBe('5 minutes ago')
  })
})
