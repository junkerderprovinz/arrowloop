import { useEffect, useRef, useState } from 'react'

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
 * selects.
 *
 * The slot that owns the live value shows that value rather than its preset,
 * so an edited colour stays drawn, marked and editable.
 */
export function AccentSwatches({
  presets,
  value,
  onChange,
  disabled,
}: {
  presets: { name: string; hex: string }[]
  value: string
  onChange: (hex: string) => void
  /** Set while the rainbow is on, when the palette decides the colours. */
  disabled?: boolean
}) {
  // The owning slot is remembered rather than recomputed as the nearest preset,
  // which would jump to another swatch while the picker is being dragged. Only
  // a value from outside (a reset, a reload) is matched to its nearest preset.
  const hexes = presets.map((p) => p.hex)
  const [owner, setOwner] = useState(() => nearest(hexes, value))
  const seen = useRef(value)
  useEffect(() => {
    if (seen.current !== value) {
      seen.current = value
      setOwner(nearest(hexes, value))
    }
    // hexes is rebuilt every render; the value is what this watches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function take(i: number, hex: string) {
    setOwner(i)
    seen.current = hex
    onChange(hex)
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      {presets.map((p, i) => {
        const mine = i === owner
        const hex = mine ? value : p.hex
        // An edited slot shows a colour other than its preset, so it is named by
        // its hex.
        const label =
          mine && value.toUpperCase() !== p.hex.toUpperCase() ? value.toUpperCase() : p.name
        return (
          <Disc
            key={p.hex}
            hex={hex}
            label={label}
            active={mine}
            onSelect={() => take(i, hex)}
            onEdit={(anchor, current) =>
              openColorPickerPopover(anchor, current, (next) => take(i, next))
            }
          />
        )
      })}
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
