import type { ReactNode, Ref } from 'react'

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
  tone = 'neutral',
  hueIndex,
  className = '',
  ref,
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
   * Neutral by default: a view has one filled accent, and it is the page's
   * floating action or a window's main button, never a row's. "subtle" sits
   * one step lower, for a control on a surface2 ground. A delete action takes
   * the same tone as its neighbours.
   */
  tone?: 'neutral' | 'subtle' | 'accent'
  /**
   * The control's own palette position, only for a control outside every card.
   * Inside one, the card already rebinds --accent for its subtree.
   */
  hueIndex?: number
  className?: string
  /** The button itself, for an animation that plays on it. */
  ref?: Ref<HTMLButtonElement>
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
      className={`${size === 'key' ? 'glim-btn-key' : ''} ${className}`.trim()}
      disabled={disabled}
      busy={busy}
      onClick={onClick}
      ref={ref}
    />
  )
}
