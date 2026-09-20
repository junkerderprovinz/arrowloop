import type { ReactNode } from 'react'

import { Button } from '../lib/glimstone/Button'

/**
 * A small, single-purpose action drawn as a glyph, built on GlimStone's Button
 * so it follows the label and colour engines like every other control. Where
 * the label mode paints text it is an ordinary labelled button; elsewhere it is
 * a square at the button height.
 */
export function IconAction({
  children,
  onClick,
  title,
  labelKey,
  hint,
  disabled,
  busy,
  size = 'default',
  tone = 'accent',
  hueIndex,
}: {
  /**
   * The mark. Usually left out, since the label key resolves one by meaning;
   * pass it only where this action's symbol is its own.
   */
  children?: ReactNode
  onClick?: () => void
  /** The control's name, shown on hover and read by a screen reader. */
  title: string
  /**
   * The translation key behind `title`, or null when the name is data.
   * Required so it cannot go missing: without a key the control has no glyph
   * and falls back to text in the modes that hide text.
   */
  labelKey: string | null
  /**
   * One sentence on what pressing it does, in the same bubble as the name, so
   * a row of icon-only buttons never needs a lone info mark among them.
   */
  hint?: string
  disabled?: boolean
  busy?: boolean
  /** GlimStone's one step up, for the action a page exists to offer. */
  size?: 'default' | 'key'
  /**
   * Accent by default, because it inherits the card's hue and so follows the
   * colour engine; "subtle" is a flat grey the engine cannot reach. A delete
   * action takes the same tone as its neighbours.
   */
  tone?: 'subtle' | 'accent'
  /**
   * The control's own palette position, only for a control outside every card.
   * Inside one, the card already rebinds --accent for its subtree.
   */
  hueIndex?: number
}) {
  return (
    <Button
      variant="icon"
      label={title}
      labelKey={labelKey}
      glyph={children}
      title={hint}
      tone={tone}
      hueIndex={hueIndex}
      className={size === 'key' ? 'glim-btn-key' : ''}
      disabled={disabled}
      busy={busy}
      onClick={onClick}
    />
  )
}
