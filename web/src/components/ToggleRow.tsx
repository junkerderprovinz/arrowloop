import type { CSSProperties } from 'react'

import { hueVars, rainbowAt } from '../lib/appearance'
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
  hueIndex,
}: {
  label: string
  /** One line on what the switch does, in the bubble beside its name. */
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
  /** For a switch whose effect depends on another one being on. */
  disabled?: boolean
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
