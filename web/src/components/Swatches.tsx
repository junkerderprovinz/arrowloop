import { useRef } from 'react'

import { openColorPickerPopover } from '../lib/colorPicker'

/**
 * One flat colour circle.
 *
 * It follows the shape engine through `--radius-pill`, so Round keeps it a
 * circle and Square squares it off, the same as every other shape-reactive
 * control. A hard-coded 50% would look identical at the default setting and
 * wrong at the other two, which is exactly the gap that only shows up once
 * somebody actually moves the corner slider.
 */
function Circle({
  hex,
  label,
  selected,
  onClick,
  innerRef,
}: {
  hex: string
  label: string
  selected?: boolean
  onClick: () => void
  innerRef?: (el: HTMLButtonElement | null) => void
}) {
  return (
    <button
      ref={innerRef}
      type="button"
      onClick={onClick}
      title={label}
      data-tip={label}
      aria-label={label}
      aria-pressed={selected}
      className="h-8 w-8 transition"
      style={{
        background: hex,
        borderRadius: 'var(--radius-pill)',
        outline: selected ? '2px solid var(--carbon-text)' : 'none',
        outlineOffset: '2px',
      }}
    />
  )
}

/**
 * The accent row: a click selects, and a click on the one already selected
 * opens the picker on it.
 *
 * The pairing costs no extra control. Reaching the editor takes the click that
 * selects, which somebody about to change a colour was going to make anyway,
 * and it leaves the row's original job intact: making every swatch open the
 * picker would mean choosing a preset became impossible, because a picker only
 * calls back on interaction and opening one changes nothing.
 *
 * The selected swatch wears the LIVE value rather than its own preset. Once the
 * picker can nudge a preset into something that is no longer a preset, showing
 * the preset would leave the colour applied everywhere and drawn nowhere: no
 * swatch would match it, none would be marked, and there would be no way back
 * into the picker that made it.
 */
export function AccentSwatches({
  presets,
  value,
  onChange,
}: {
  presets: { name: string; hex: string }[]
  value: string
  onChange: (hex: string) => void
}) {
  const buttons = useRef<Record<number, HTMLButtonElement | null>>({})
  const owner = nearest(presets.map((p) => p.hex), value)

  return (
    <div className="flex flex-wrap gap-2">
      {presets.map((p, i) => {
        const mine = i === owner
        // The slot that owns the live value shows it, and its name becomes the
        // hex: a preset's name on a circle that is no longer that preset is the
        // one label worse than none.
        const hex = mine ? value : p.hex
        const label = mine && value.toUpperCase() !== p.hex.toUpperCase() ? value.toUpperCase() : p.name
        return (
          <Circle
            key={p.hex}
            hex={hex}
            label={label}
            selected={mine}
            innerRef={(el) => {
              buttons.current[i] = el
            }}
            onClick={() => {
              const el = buttons.current[i]
              if (mine && el) openColorPickerPopover(el, hex, onChange)
              else onChange(p.hex)
            }}
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
 * accent row one of five is chosen and the rest are offers, so a click can mean
 * select. In a palette there is no "the selected one" to click twice, so a
 * click can only mean edit.
 */
export function PaletteSwatches({
  palette,
  onChange,
}: {
  palette: string[]
  onChange: (next: string[]) => void
}) {
  const buttons = useRef<Record<number, HTMLButtonElement | null>>({})
  return (
    <div className="flex flex-wrap gap-2">
      {palette.map((hex, i) => (
        <Circle
          key={`${i}-${hex}`}
          hex={hex}
          label={hex.toUpperCase()}
          innerRef={(el) => {
            buttons.current[i] = el
          }}
          onClick={() => {
            const el = buttons.current[i]
            if (!el) return
            openColorPickerPopover(el, hex, (next) => {
              const copy = [...palette]
              copy[i] = next
              onChange(copy)
            })
          }}
        />
      ))}
    </div>
  )
}

/**
 * Which preset a live colour belongs to: plain squared distance in RGB.
 *
 * It only has to be stable and unsurprising across widely separated hues, which
 * is what the five presets are, so a perceptual colour space would be precision
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
