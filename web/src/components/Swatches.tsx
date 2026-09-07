import { useEffect, useRef, useState } from 'react'

import { openColorPickerPopover } from '../lib/colorPicker'

/**
 * One colour disc, built the way BombVault builds it.
 *
 * A bordered wrapper around a smaller disc, rather than a disc with an outline
 * on the selected one. That difference is not decoration: an outline is drawn
 * OUTSIDE the box, so the selected swatch grew by four pixels and the row
 * jumped every time somebody picked a different colour. Here every swatch keeps
 * the same 32px outer box in both states and only the border's COLOUR moves,
 * which is what makes a row of eight read as one control.
 *
 * The radius comes from the shape engine, so Round keeps it a circle and Square
 * squares it off like every other shape-reactive control. A hard-coded 50%
 * would look identical at the default and wrong at the other two.
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
 * The accent row: one click both chooses the colour and opens the picker on it.
 *
 * Both, from the same click, and that is deliberate rather than clever. The
 * previous version reserved the picker for a SECOND click on the already
 * chosen swatch, which is defensible in isolation and was reported as "kein
 * Farbpicker": a control nobody can find is a control that is not there. Here
 * the inner button opens the picker and the click bubbles to the wrapper, which
 * selects, so the row keeps its original job and the picker stops being a
 * secret. Same construction as BombVault's own preset row.
 *
 * The slot that owns the live value shows it rather than its own preset. Once
 * the picker can nudge a preset into something that is no longer a preset,
 * showing the preset would leave the colour applied everywhere and drawn
 * nowhere: no swatch would match it, none would be marked, and there would be
 * no way back into the picker that made it.
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
  /** Dimmed and inert while the rainbow is on: the palette decides the colours
   *  then, so an accent picked here would change nothing anybody can see. */
  disabled?: boolean
}) {
  /**
   * Which slot holds the live colour, remembered rather than recomputed.
   *
   * It used to be worked out from the colour itself, by nearest preset, on
   * every render. That is fine until the picker nudges a colour far enough to
   * be nearer a DIFFERENT preset, and then the live value silently moves to
   * another swatch while somebody is still dragging in the picker that opened
   * on the first one: "wenn ich im farbpicker eine farbe wähle springt es in
   * ein anderes farbfeld". Nearest is still how an unknown colour finds its
   * home, but only when the value arrives from OUTSIDE (a reset, a reload).
   * A slot somebody is editing keeps its colour however far they take it.
   */
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
        // A preset's name on a circle that is no longer that preset is the one
        // label worse than none, so an edited slot names its own hex instead.
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
 * The palette row, where every colour is in force at once.
 *
 * Two rows that look identical and behave differently is correct here: what
 * differs is not the control but whether the set has a selection at all. In an
 * accent row one swatch is chosen and the rest are offers. In a palette there
 * is no "the selected one", so a click can only mean edit.
 */
export function PaletteSwatches({
  palette,
  onChange,
  disabled,
}: {
  palette: string[]
  onChange: (next: string[]) => void
  /** Dimmed and inert while the rainbow is off: editing a palette nothing
   *  reads is a setting that appears to do nothing. */
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
 * Which preset a live colour belongs to: plain squared distance in RGB.
 *
 * It only has to be stable and unsurprising across widely separated hues, which
 * is what the presets are, so a perceptual colour space would be precision
 * nobody can see spent on a question nobody asks.
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
