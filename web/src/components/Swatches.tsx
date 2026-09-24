import { useRef } from 'react'

import { openColorPickerPopover } from '../lib/colorPicker'

/**
 * One colour disc: a bordered wrapper around a smaller disc, so selecting it
 * changes only the border colour and the row never shifts. The radius follows
 * the shape engine.
 */
function Disc({
  hex,
  label,
  active,
  onSelect,
  onEdit,
}: {
  hex: string
  label: string
  /** Whether this swatch's own colour is the one currently in force. */
  active?: boolean
  onSelect?: () => void
  onEdit: (anchor: HTMLButtonElement, hex: string) => void
}) {
  const button = useRef<HTMLButtonElement>(null)
  return (
    <span
      onClick={onSelect}
      className="inline-flex transition-transform hover:scale-110"
      style={{
        borderRadius: 'var(--radius-pill)',
        border: '2px solid',
        borderColor: active ? 'var(--carbon-text)' : 'var(--carbon-border)',
      }}
    >
      <button
        ref={button}
        type="button"
        data-tip={label}
        aria-label={label}
        aria-pressed={active}
        onClick={() => button.current && onEdit(button.current, hex)}
        className="h-7 w-7"
        style={{ background: hex, borderRadius: 'var(--radius-pill)' }}
      />
    </span>
  )
}

/**
 * The accent row. One click selects a swatch and opens the picker on it: the
 * inner button opens the picker and the click bubbles to the wrapper, which
 * selects. Each swatch holds its own colour, so an edited one keeps it after
 * another is chosen.
 */
export function AccentSwatches({
  presets,
  slots,
  value,
  onChange,
  onSlots,
  disabled,
}: {
  presets: { name: string; hex: string }[]
  /** The colour each swatch holds, edited or not. */
  slots: string[]
  value: string
  onChange: (hex: string) => void
  onSlots: (next: string[]) => void
  /** Set while the rainbow is on, when the palette decides the colours. */
  disabled?: boolean
}) {
  // A value no swatch holds came from outside (an older setting), and belongs
  // to the swatch nearest to it.
  const same = slots.findIndex((hex) => hex.toUpperCase() === value.toUpperCase())
  const owner = same >= 0 ? same : nearest(slots, value)

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      {slots.map((hex, i) => (
        <Disc
          key={i}
          hex={hex}
          // An edited swatch no longer shows its preset, so it is named by its hex.
          label={
            hex.toUpperCase() === presets[i]?.hex.toUpperCase() ? (presets[i]?.name ?? hex) : hex.toUpperCase()
          }
          active={i === owner}
          onSelect={() => onChange(hex)}
          onEdit={(anchor, current) =>
            openColorPickerPopover(anchor, current, (next) => {
              onSlots(slots.map((h, j) => (j === i ? next : h)))
              onChange(next)
            })
          }
        />
      ))}
    </div>
  )
}

/**
 * The palette row. Every colour is in force at once, so there is no selection
 * and a click edits.
 */
export function PaletteSwatches({
  palette,
  onChange,
  disabled,
}: {
  palette: string[]
  onChange: (next: string[]) => void
  /** Set while the rainbow is off, when nothing reads the palette. */
  disabled?: boolean
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      {palette.map((hex, i) => (
        <Disc
          key={`${i}-${hex}`}
          hex={hex}
          label={hex.toUpperCase()}
          onEdit={(anchor, current) =>
            openColorPickerPopover(anchor, current, (next) => {
              const copy = [...palette]
              copy[i] = next
              onChange(copy)
            })
          }
        />
      ))}
    </div>
  )
}

/**
 * Which preset a live colour belongs to, by squared distance in RGB. The
 * presets are widely separated hues, so a perceptual space would gain nothing.
 */
function nearest(presets: string[], value: string): number {
  const target = rgb(value)
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  presets.forEach((hex, i) => {
    const c = rgb(hex)
    const d = (c.r - target.r) ** 2 + (c.g - target.g) ** 2 + (c.b - target.b) ** 2
    if (d < bestDistance) {
      bestDistance = d
      best = i
    }
  })
  return best
}

function rgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const n = Number.parseInt(full, 16)
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 }
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
