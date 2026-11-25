import { describe, expect, it } from 'vitest'

import { allLocales as locales } from '../lib/localesForTests'

// The shared lists live on the Sync tile, and the sentence that sends people
// there has to call it what the tile itself says.
describe.each(Object.entries(locales))('the empty shared lists in %s', (_code, table) => {
  it('point to the Sync tile by its name', () => {
    expect(table['sets.noneYet']).toContain(table['settings.sync'])
  })
})
