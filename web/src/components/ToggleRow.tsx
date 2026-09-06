import type { CSSProperties } from 'react'

import { hueVars, rainbowAt } from '../lib/appearance'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { Toggle } from '../lib/glimstone/Toggle'
import { useRainbow } from './Shell'

/**
 * One switch on its own row: the name on the left, the switch hard right.
 *
 * The switch itself is GlimStone's `Toggle` and is not reimplemented here. What
 * this file adds is the ROW, and that is deliberately app-level: the language
 * ships the control, an app arranges it. This arrangement is copied from
 * BombVault's own `ToggleRow`, down to the type size and the gap, because two
 * apps in the same house whose switch rows sit a few pixels apart is exactly
 * the drift that gets reported as "sieht nicht aus wie in BV".
 *
 * `items-start` rather than `items-center`, so a label that wraps to two lines
 * keeps the switch beside its FIRST line rather than floating to the middle of
 * the block.
 */
export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  hueIndex,
}: {
  label: string
  /** One line saying what this switch does, in the bubble beside its name. An
   *  explanation belongs next to the thing it explains, never as a grey
   *  paragraph underneath. */
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
  /**
   * Dimmed and inert, for a switch whose effect depends on another one being
   * on. Left live it would take a click, store a value and change nothing,
   * which reads as a broken control rather than an unavailable one.
   */
  disabled?: boolean
  /**
   * This row's own position in the palette.
   *
   * A group of switches sharing one accent reads as one setting with several
   * parts. Giving each its own position makes them read as what they are. The
   * position goes on the ROW rather than on the track, because `.glim-hue`
   * rebinds the accent for its whole subtree and the fill and the focus ring
   * have to move together.
   */
  hueIndex?: number
}) {
  useRainbow()
  const hued = hueIndex !== undefined
  return (
    <div
      className={`flex items-start justify-between gap-4${hued ? ' glim-hue' : ''}`}
      style={hued ? (hueVars(rainbowAt(hueIndex)) as CSSProperties) : undefined}
    >
      <span
        className={`flex items-center gap-1.5 text-sm text-carbon-text${
          disabled ? ' opacity-50' : ''
        }`}
      >
        {label}
        {hint && <InfoBubble tip={hint} />}
      </span>
      {/* The row draws the name, so the control must not draw it again. */}
      <Toggle checked={checked} onChange={onChange} label={label} hideLabel disabled={disabled} />
    </div>
  )
}
