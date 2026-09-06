import type { ReactNode } from 'react'

import { Badge } from '../lib/glimstone/Badge'

/**
 * A small, single-purpose action drawn as a glyph in a square badge.
 *
 * Not a component of its own so much as a name for one call: GlimStone's Badge
 * already is this control, and this file exists so that eleven call sites do not
 * each spell out `as="button" shape="square" size="icon"` and drift. BombVault
 * writes the same four props at its own icon actions; the shape is the house
 * one, the shorthand is local.
 *
 * The name rides in the tip rather than as a visible label. "Copy" or "Delete"
 * sitting in its own pill beside three icon-only controls reads as a stray
 * caption and spends row width on a word the hover already says, and the tip is
 * the accessible name too, so nothing is lost but the ink.
 *
 * `hint` is a second sentence rather than a joined phrase, so neither half has
 * to be written to fit beside the other in forty-two languages. It exists
 * because a row of icon-only buttons must never need a lone "(i)" standing
 * among them: an explanation belongs beside a control's LABEL, and these have
 * none, so the sentence rides in the bubble the pointer is already heading for.
 */
export function IconAction({
  children,
  onClick,
  title,
  hint,
  disabled,
  tone,
}: {
  children: ReactNode
  onClick?: () => void
  /** The control's name, shown on hover and read by a screen reader. */
  title: string
  /** One sentence on what pressing it does, in the same bubble as the name. */
  hint?: string
  disabled?: boolean
  /**
   * Left alone for almost everything.
   *
   * A destructive action does NOT get a red badge here: the design language is
   * explicit that a delete trigger takes the same treatment as the badges beside
   * it and carries its meaning in its glyph, its tip and the confirmation it
   * opens. Painting it red makes it the one bespoke thing in a card where
   * everything else follows the colour engine.
   */
  tone?: 'neutral' | 'active'
}) {
  return (
    <Badge
      as="button"
      shape="square"
      size="icon"
      tone={tone}
      tip={hint ? `${title}. ${hint}` : title}
      ariaLabel={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Badge>
  )
}
