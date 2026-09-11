import type { ReactNode } from 'react'

import * as glyphs from '../components/glyphs'
import { glyphNameFor } from './glyphName'

/**
 * The mark for a translation key, as an element.
 *
 * The DECISION lives in `glyphName.ts`, which the phone reads too; this is the
 * browser's half of it, and all it does is turn a name into the component of
 * that name. Keeping the rule table here as well would be two tables, and two
 * tables are how a button ends up wearing a tick in one place and a magnifier
 * in the other.
 */

const BY_NAME = glyphs as unknown as Record<string, (props: Record<string, unknown>) => ReactNode>

export function glyphFor(key: string): ReactNode | undefined {
  const name = glyphNameFor(key)
  if (!name) return undefined
  const Mark = BY_NAME[name]
  // A name the component file does not carry is a table that has drifted, and
  // it must not render as an empty square: falling through to undefined leaves
  // the button showing its own text, which is the failure mode worth having.
  return Mark ? <Mark /> : undefined
}
