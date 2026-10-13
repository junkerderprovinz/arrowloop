import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { en, type TranslationKey } from '../../lib/i18n'
import type { TileId } from '../../lib/routes'
import { SETTINGS_INDEX } from './searchIndex'
import { buildItems, search } from './SettingsSearch'
import { settingsTiles } from './tiles'

const t = (k: TranslationKey) => en[k]

/** The file that draws each tile's own cards. */
const PAGES: Partial<Record<TileId, string>> = {
  general: 'GeneralPage.tsx',
  look: 'LookPage.tsx',
  sync: 'SyncPage.tsx',
  safety: 'SafetyPage.tsx',
  info: 'InfoPage.tsx',
}

describe('the settings search', () => {
  it('knows every card a tile draws', () => {
    for (const [tile, file] of Object.entries(PAGES)) {
      const text = readFileSync(new URL(file, import.meta.url), 'utf8')
      const drawn = [...text.matchAll(/<(?:Card|BackupCard)\b[^>]*?title=\{t\('([^']+)'\)\}/g)].map((m) => m[1])
      const known = SETTINGS_INDEX[tile as TileId].map((c) => c.title)
      expect(drawn.filter((k) => !known.includes(k as TranslationKey)), tile).toEqual([])
    }
  })

  it('finds a page by the name it carried before', () => {
    const [first] = search(buildItems(t, settingsTiles(true)), 'engine')
    expect(first?.item).toMatchObject({ tile: 'sync', former: true })
  })

  it('finds the Apps tile by the name App it carried before', () => {
    const hits = search(buildItems(t, settingsTiles(true)), 'App')
    expect(hits.some((h) => h.item.tile === 'apps' && h.item.former)).toBe(true)
  })

  it('finds a card by the title it carried before and leads to it', () => {
    const [first] = search(buildItems(t, settingsTiles(true)), 'what gets carried')
    expect(first?.item).toMatchObject({ tile: 'sync', former: true, cardName: 'Contents' })
  })

  it('finds a setting by a word that only its explanation holds', () => {
    const hits = search(buildItems(t, settingsTiles(true)), 'megabyte')
    expect(hits[0]).toMatchObject({ inHint: true, item: { name: 'Bandwidth limit', tile: 'general' } })
  })

  it('leaves out the tiles this build does not offer', () => {
    const tiles = new Set(buildItems(t, settingsTiles(false)).map((i) => i.tile))
    expect(tiles.has('security')).toBe(false)
  })
})
