import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import { hueVars, rainbowAt } from '../lib/appearance'
import { groupStage } from '../lib/controls'
import { useRainbow } from './Shell'

/**
 * The one horizontal selector for tabs, filter bars and segmented controls.
 *
 * The big scale pins every segment to the widest label or an app-wide floor,
 * so page-level pickers render equally wide; the small scale skips the
 * pinning, for strips that repeat down a page or sit in a narrow panel.
 */
export type Option<T extends string> = { value: T; label: string; icon?: ReactNode }

/**
 * The floor for a big selector's segments, matching BombVault's
 * `MIN_PINNED_WIDTH`. A label that needs more still gets it.
 */
const MIN_SEGMENT = 200

export function Selector<T extends string>({
  options,
  value,
  onChange,
  scale = 'big',
  variant = 'well',
  fill = false,
  label,
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
  /**
   * Fill the given width with equal segments, for a strip that heads a column
   * of cards and should not be narrower than what it introduces.
   */
  fill?: boolean
  label?: string
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

  // Measured rather than a flex share: a flex item with a zero basis adds
  // nothing to a shrink-to-fit parent and truncates the widest label.
  const [width, setWidth] = useState<number | null>(null)

  // Pass 1 drops the applied width when the labels change. A segment with an
  // explicit width measures as that width, so measuring without this grows the
  // strip on every render.
  useLayoutEffect(() => {
    if (scale === 'big') setWidth(null)
  }, [scale, labelKey])

  // Pass 2 measures the widest natural segment and pins all of them to it.
  // Both passes are layout effects, so nothing flickers between them.
  useLayoutEffect(() => {
    if (scale !== 'big' || width !== null || !track.current) return
    let widest = 0
    for (const el of track.current.querySelectorAll<HTMLElement>('[data-segment]')) {
      widest = Math.max(widest, el.getBoundingClientRect().width)
    }
    if (widest === 0) return

    // The floor is capped at this strip's share of the room it has, so a
    // narrow column shrinks the segments together instead of wrapping the
    // last one. Measured off the parent, since the track is fit-content.
    const parent = track.current.parentElement
    const room = parent ? parent.getBoundingClientRect().width : 0
    const gaps = 0.2 * 16 * (options.length + 1)
    const share = room > 0 ? (room - gaps) / options.length : Number.POSITIVE_INFINITY
    setWidth(Math.min(Math.max(widest, MIN_SEGMENT), Math.max(widest, share)))
  }, [scale, width, labelKey, options.length])

  // Every segment reads a rainbow position, so the strip repaints when the
  // mode changes.
  useRainbow()

  return (
    <div
      ref={track}
      role="tablist"
      aria-label={label}
      className={
        variant === 'well'
          ? 'glim-well inline-flex flex-wrap gap-[0.2rem] p-[0.2rem]'
          : 'inline-flex flex-wrap gap-1'
      }
      style={{
        borderRadius: variant === 'well' ? 'var(--radius-control)' : undefined,
        width: fill ? '100%' : 'fit-content',
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
              ...(hueVars(rainbowAt(i)) as CSSProperties),
              // The full control radius, as BombVault uses; subtracting the
              // well's padding left the strip looking square at the Soft stage.
              borderRadius: 'var(--radius-control)',
              width: scale === 'big' && width ? width : undefined,
              minWidth: scale === 'big' ? undefined : `calc(var(--btn-w-${stage}) / ${options.length})`,
              flex: fill ? '1 1 0' : 'none',
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
