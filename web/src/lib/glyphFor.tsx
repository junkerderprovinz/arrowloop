import type { ReactNode } from 'react'

import * as glyphs from '../components/glyphs'
import { glyphNameFor } from './glyphName'

const BY_NAME = glyphs as unknown as Record<string, (props: Record<string, unknown>) => ReactNode>

/**
 * The mark for a translation key, as an element. The rule table is in
 * `glyphName.ts`, shared with the phone; this only turns a name into a component.
 */
export function glyphFor(key: string): ReactNode | undefined {
  const name = glyphNameFor(key)
  if (!name) return undefined
  const Mark = BY_NAME[name]
  // An unknown name leaves the button showing its text rather than an empty square.
  return Mark ? <Mark /> : undefined
}
