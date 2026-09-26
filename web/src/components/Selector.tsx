import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import { hueVars } from '../lib/appearance'
import { groupStage } from '../lib/controls'
import { useRainbow } from './Shell'

/**
 * The one horizontal selector for tabs, filter bars and segmented controls.
 *
 * The big scale pins every segment to the widest label or an app-wide floor,
 * so page-level pickers render equally wide; the small scale skips the
 * pinning, for strips that repeat down a page or sit in a narrow panel. At
 * both scales the strip spans the width of its box and the segments share it,
 * since a strip that stops short leaves a ragged edge down a card of them.
 */
export type Option<T extends string> = { value: T; label: string; icon?: ReactNode }

/**
 * The floor for a big selector's segments, matching BombVault's
 * `MIN_PINNED_WIDTH`. A label that needs more still gets it.
 */
const MIN_SEGMENT = 200

/**
 * Where each selector in the settings starts in the palette. Stacked selectors
 * of similar width would otherwise repeat every colour straight down the page;
 * settingsHue.test.ts holds every settings selector to this table. The engine
 * tab's three share starts with the look tab's, since the two are never on
 * screen together, and none shares the section tabs' start above both.
 */
export const HUE_OFFSET = {
  tabs: 0,
  /** The three label rows take +0..2 by row, so the block reads as one group. */
  labels: 1,
  shape: 4,
  motion: 5,
  theme: 6,
  direction: 1,
  mode: 2,
  foldCase: 3,
} as const

/** The gaps between segments, in pixels: 0.2rem in the well, 0.25rem between chips. */
const WELL_GAP = 3.2
const CHIP_GAP = 4

export function Selector<T extends string>({
  options,
  value,
  onChange,
  scale = 'big',
  variant = 'well',
  hueOffset = 0,
  label,
  labelledBy,
  disabled = false,
}: {
  options: Option<T>[]
  value: T
  onChange: (next: T) => void
  scale?: 'big' | 'small'
  /**
   * `well` is a groove holding keys: one filled track, idle segments
   * transparent, only the chosen one filled. `chip` has no track; every segment
   * carries its own fill, so the row reads as tabs on the page.
   */
  variant?: 'well' | 'chip'
  /** Where this selector starts in the palette; see HUE_OFFSET. */
  hueOffset?: number
  label?: string
  /** The id of a visible label, used in place of `label`. */
  labelledBy?: string
  /**
   * Dimmed and inert, for a control whose value comes from elsewhere. It still
   * shows that value, so the card keeps one shape.
   */
  disabled?: boolean
}) {
  const track = useRef<HTMLDivElement>(null)

  // The stage comes from the labels rather than what is drawn, so the strip
  // keeps its width when the label engine hides the words.
  const stage = useMemo(() => groupStage(options.map((o) => o.label)), [options])

  // Callers build options inline, so the effects key on the labels as one
  // string instead of the array. The newline keeps two label sets that
  // concatenate alike apart.
  const labelKey = options.map((o) => o.label).join('\n')

  // The widest natural segment, measured rather than a flex share: a flex item
  // with a zero basis adds nothing to a shrink-to-fit parent and truncates the
  // widest label.
  const [widest, setWidest] = useState<number | null>(null)
  // The parent's content width. A card's padding is not room: counted as room,
  // it wraps a fourth option.
  const [room, setRoom] = useState(0)

  // Pass 1 drops the measurement when the labels change. A segment with an
  // explicit width measures as that width, so measuring without this grows the
  // strip on every render.
  useLayoutEffect(() => {
    if (scale === 'big') setWidest(null)
  }, [scale, labelKey])

  // Pass 2 measures the natural segments. Both passes are layout effects, so
  // nothing flickers between them.
  useLayoutEffect(() => {
    if (scale !== 'big' || widest !== null || !track.current) return
    let most = 0
    for (const el of track.current.querySelectorAll<HTMLElement>('[data-segment]')) {
      most = Math.max(most, el.getBoundingClientRect().width)
    }
    if (most > 0) setWidest(most)
  }, [scale, widest, labelKey])

  // How many segments share a row depends on the room, so it follows the
  // parent's size and not only the labels.
  useLayoutEffect(() => {
    const parent = track.current?.parentElement
    if (!parent) return
    const measure = () => {
      const pad = getComputedStyle(parent)
      setRoom(parent.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  const n = options.length
  const gap = variant === 'well' ? WELL_GAP : CHIP_GAP
  const inner = room - (variant === 'well' ? 2 * WELL_GAP : 0)
  // The floor is capped at this strip's share of the room, so a narrow column
  // shrinks the segments together before it wraps the last one.
  const share = inner > 0 ? (inner - gap * (n - 1)) / n : Number.POSITIVE_INFINITY
  const pinned =
    scale === 'big' && widest !== null
      ? Math.min(Math.max(widest, MIN_SEGMENT), Math.max(widest, share))
      : null
  // Once it wraps, the segments share each row evenly and grow to fill it, so
  // no row ends in an empty strip: six that fit four to a row go three and
  // three.
  const fit = pinned && inner > 0 ? Math.max(1, Math.floor((inner + gap) / (pinned + gap))) : n
  const perRow = Math.ceil(n / Math.ceil(n / fit))

  // Every segment reads a rainbow position, so the strip repaints when the
  // mode changes.
  useRainbow()

  return (
    <div
      ref={track}
      role="tablist"
      aria-label={label}
      aria-labelledby={labelledBy}
      className={
        variant === 'well'
          ? 'glim-well flex w-full flex-wrap gap-[0.2rem] p-[0.2rem]'
          : 'flex w-full flex-wrap gap-1'
      }
      style={{
        borderRadius: variant === 'well' ? 'var(--radius-pill)' : undefined,
        opacity: disabled ? 0.45 : undefined,
        pointerEvents: disabled ? 'none' : undefined,
      }}
    >
      {options.map((o, i) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            data-segment
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            style={{
              // Each segment takes its own palette position. It sits on the
              // segment because `.glim-hue` rebinds the accent for the fill,
              // the ink and the focus ring together.
              ...(hueVars(i + hueOffset) as CSSProperties),
              // The full control radius, as BombVault uses; subtracting the
              // well's padding left the strip looking square at the Soft stage.
              borderRadius: 'var(--radius-pill)',
              ...(pinned !== null
                ? {
                    // The basis leaves one gap of slack so rounding cannot
                    // push a full row's last segment down; growth takes it
                    // back.
                    minWidth: pinned,
                    flex: `1 0 calc((100% - ${perRow} * ${gap}px) / ${perRow})`,
                  }
                : scale === 'big'
                  ? { flex: 'none' }
                  : { minWidth: `calc(var(--btn-w-${stage}) / ${n})`, flex: '1 0 auto' }),
            }}
            className={[
              'glim-hue glim-hue-icon glim-tab inline-flex items-center justify-center gap-1.5 px-3',
              // A height token rather than padding, so every strip is exactly
              // the same height.
              'h-[var(--badge-md)] text-xs font-medium',
              '[transition:background-color_120ms_ease]',
              active
                ? 'glim-active bg-accent text-accentContrast'
                : variant === 'well'
                  ? 'bg-transparent text-carbon-textSub hover:bg-carbon-hover hover:text-carbon-text'
                  : // With no groove behind it, an idle chip needs its own fill.
                    'bg-carbon-surface2 text-carbon-textSub hover:bg-carbon-surface3 hover:text-carbon-text',
            ].join(' ')}
          >
            {o.icon && (
              <span className="glim-tab-glyph" aria-hidden>
                {o.icon}
              </span>
            )}
            <span className="glim-tab-label">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
