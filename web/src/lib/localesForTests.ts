// Every locale table at once, for the tests that have to compare them.
//
// The application loads languages one chunk at a time and keeps only English
// and German resident. The parity guard needs all forty-two in one place, which
// is the opposite requirement, so it gets its own eager glob here.
//
// NOTHING IN THE APPLICATION MAY IMPORT THIS FILE. Vite builds from what the
// entry point reaches, so one import from application code would pull all
// forty-two back into the bundle and undo the split without failing anything:
// the tests would still pass, the interface would still work, and every visitor
// would quietly download forty-one languages they are not reading.

import { de, en, type Translations } from './i18n'

const eager = import.meta.glob<{ default: Partial<Translations> }>('./locales/*.ts', { eager: true })

/** code to table, for all forty-two. */
export const allLocales: Record<string, Partial<Translations>> = { en, de }

for (const [path, mod] of Object.entries(eager)) {
  const code = path.replace('./locales/', '').replace(/\.ts$/, '')
  allLocales[code] = mod.default
}
