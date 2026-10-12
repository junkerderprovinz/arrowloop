import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { en, type TranslationKey } from '../../lib/i18n'
import type { TabId } from '../../lib/routes'
import { SETTINGS_INDEX } from './searchIndex'
import { buildItems, search } from './SettingsSearch'
import { settingsTabs } from './tabs'

const t = (k: TranslationKey) => en[k]

/** The file that draws each tab's own cards. */
const PAGES: Partial<Record<TabId, string>> = {
  general: 'GeneralPage.tsx',
  look: 'LookPage.tsx',
  sync: 'SyncPage.tsx',
  safety: 'SafetyPage.tsx',
  info: 'InfoPage.tsx',
}

describe('the settings search', () => {
  it('knows every card a tab draws', () => {
    for (const [tab, file] of Object.entries(PAGES)) {
      const text = readFileSync(new URL(file, import.meta.url), 'utf8')
      const drawn = [...text.matchAll(/<(?:Card|BackupCard)\b[^>]*?title=\{t\('([^']+)'\)\}/g)].map((m) => m[1])
      const known = SETTINGS_INDEX[tab as TabId].map((c) => c.title)
      expect(drawn.filter((k) => !known.includes(k as TranslationKey)), tab).toEqual([])
    }
  })

  it('finds a page by the name it carried before', () => {
    const [first] = search(buildItems(t, settingsTabs(true)), 'engine')
    expect(first?.item).toMatchObject({ tab: 'sync', former: true })
  })

  it('finds the Apps tab by the name App it carried before', () => {
    const hits = search(buildItems(t, settingsTabs(true)), 'App')
    expect(hits.some((h) => h.item.tab === 'apps' && h.item.former)).toBe(true)
  })

  it('finds a setting by a word that only its explanation holds', () => {
    const hits = search(buildItems(t, settingsTabs(true)), 'megabyte')
    expect(hits[0]).toMatchObject({ inHint: true, item: { name: 'Bandwidth limit', tab: 'general' } })
  })

  it('leaves out the tabs this build does not offer', () => {
    const tabs = new Set(buildItems(t, settingsTabs(false)).map((i) => i.tab))
    expect(tabs.has('security')).toBe(false)
  })
})
