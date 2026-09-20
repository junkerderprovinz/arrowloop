// Every locale table at once, for the tests that compare them.
//
// Application code must not import this file: the eager glob would pull every
// language back into the bundle and undo the per-language chunks, and nothing
// would fail.

import { de, en, type Translations } from './i18n'

const eager = import.meta.glob<{ default: Partial<Translations> }>('./locales/*.ts', { eager: true })

/** Code to table, for every language. */
export const allLocales: Record<string, Partial<Translations>> = { en, de }

for (const [path, mod] of Object.entries(eager)) {
  const code = path.replace('./locales/', '').replace(/\.ts$/, '')
  allLocales[code] = mod.default
}
