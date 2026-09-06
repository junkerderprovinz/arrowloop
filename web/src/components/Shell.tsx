import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { subscribeRainbow } from '../lib/appearance'

/**
 * What is left of this file after GlimStone 1.7.0.
 *
 * The card, the badge, the button, the switch, the confirm surface and the
 * bubbles all used to be built here, from the design language's prose. They are
 * now copied verbatim from `lib/glimstone/`, which is that language's own React
 * source, and this file keeps only the four small things that are genuinely
 * this app's own arrangement rather than the language's controls.
 *
 * The reason for the move is the reason GlimStone shipped the folder: two apps
 * built from the same document arrived at the same language in two dialects.
 * This one called the switch `Switch` and kept it in `Field.tsx`; BombVault
 * calls it `Toggle` in a file of its own. Both readings were correct against the
 * prose, and both had to be fixed by hand every time a rule changed. Nothing in
 * `lib/glimstone/` is edited here: an edited copy is a fork, and the next
 * release of that folder would not reach it.
 */

/**
 * Re-render when the rainbow changes.
 *
 * The palette, the rotation and whether the mode is on at all are held outside
 * React, because they are set on the document root and read by CSS. Anything
 * that asks for a colour has to be woken when they change, or turning the mode
 * on paints the cards and leaves every badge inside them on the old accent
 * until something else happens to re-render.
 */
export function useRainbow(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeRainbow(() => setVersion((v) => v + 1)), [])
  return version
}

/**
 * Cards stack on one shared rhythm of 40px (rule 20). A smaller gap reads as
 * cramped once every card carries a title badge overlapping its top edge.
 */
export function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-10">{children}</div>
}

/**
 * Digits that change or stack use tabular figures (rule 7), so a count does not
 * jitter sideways while it counts.
 */
export function Num({ children }: { children: ReactNode }) {
  return <span className="glim-num">{children}</span>
}

/** A hairline separator. Hierarchy comes from type and colour step, so this is
 *  as much of a line as the design language allows (rule 5). */
export function Rule() {
  return <div className="h-px w-full" style={{ background: 'var(--hairline)' }} />
}

/**
 * The empty state. A list with nothing in it still has to say what it is and
 * why it is empty, or it reads as a page that failed to load.
 */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-[12px] text-carbon-textMuted">{children}</p>
}

/**
 * The secondary actions of one row, revealed on hover.
 *
 * A long list reads as content, not as a wall of buttons. The row's primary
 * action stays outside this and is always visible.
 *
 * The group survives being hovered, because it is the pointer entering the ROW
 * that reveals it, not the pointer entering the buttons: a control that
 * disappears the moment somebody reaches for it is worse than one that was
 * never hidden. Keyboard focus reveals it too, or the buttons would be
 * reachable by tab and invisible while focused.
 */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
      {children}
    </div>
  )
}
