import type { CSSProperties } from 'react'

import { hueVars } from '../lib/appearance'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { Toggle } from '../lib/glimstone/Toggle'
import { useRainbow } from './Shell'

/**
 * GlimStone's Toggle on a row of its own, name left and switch right, laid out
 * like BombVault's ToggleRow. `items-start` keeps the switch beside the first
 * line of a wrapping label.
 */
export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  resting,
  refused,
  hueIndex,
}: {
  label: string
  /** One line on what the switch does, in the bubble beside its name. */
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
  /** For a switch whose effect depends on another one being on. */
  disabled?: boolean
  /** For a switch that has no effect right now but keeps its state for when it does. */
  resting?: boolean
  /** Why the switch cannot be flipped right now; see GlimStone's Toggle. */
  refused?: string
  /**
   * The row's own palette position. It sits on the row because `.glim-hue`
   * rebinds the accent for the fill and the focus ring together.
   */
  hueIndex?: number
}) {
  useRainbow()
  const hued = hueIndex !== undefined
  return (
    <div
      // The reason line under the row needs room to wrap onto a touch screen.
      className={`flex items-start justify-between gap-4${refused ? ' flex-wrap' : ''}${hued ? ' glim-hue' : ''}`}
      style={hued ? (hueVars(hueIndex) as CSSProperties) : undefined}
    >
      {/* data-glim-label is where the settings search scrolls to. */}
      <span
        data-glim-label={label}
        className={`flex items-center gap-1.5 text-body text-carbon-text${
          disabled || resting || refused ? ' opacity-50' : ''
        }`}
      >
        {label}
        {hint && <InfoBubble tip={hint} />}
      </span>
      {/* The row draws the name, so the control must not draw it again. */}
      <Toggle checked={checked} onChange={onChange} label={label} hideLabel disabled={disabled} refused={refused} />
    </div>
  )
}
