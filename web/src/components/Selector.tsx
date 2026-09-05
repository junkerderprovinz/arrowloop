import { useLayoutEffect, useRef, useState } from 'react'

/**
 * The one horizontal selector: tabs, filter bars and segmented controls are the
 * same control, built once. A second hand-rolled selector drifts from the first
 * the moment either changes.
 *
 * Two scales, one implementation. The big one pins every segment to the widest
 * label or to a shared app-wide floor, whichever is larger, so that every
 * page-level picker in the app renders identically wide. The small one is the
 * same code with that pinning switched off, for a strip that repeats down a
 * page or sits inside a narrow panel. They differ in exactly the thing the
 * prop is named after, which is what stops the two from diverging again.
 */
export type Option<T extends string> = { value: T; label: string; icon?: string }

/**
 * The app-wide floor for a big selector's segments. One constant, picked once,
 * comfortably above the longest label anywhere in an equal-width selector — a
 * strip whose own content needs more still measures larger and is never clamped
 * down to this.
 */
const MIN_SEGMENT = 160

export function Selector<T extends string>({
  options,
  value,
  onChange,
  scale = 'big',
  label,
}: {
  options: Option<T>[]
  value: T
  onChange: (next: T) => void
  scale?: 'big' | 'small'
  label?: string
}) {
  const track = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(null)

  // The width is a real measurement, never a guessed pixel value: it has to
  // follow the label set, the font and the locale. A flex share cannot do this
  // job, because a flex item whose basis resolves to zero contributes zero to
  // a shrink-to-fit parent, which truncates the widest label the moment nothing
  // stretches the track.
  useLayoutEffect(() => {
    if (scale !== 'big' || !track.current) return
    let widest = 0
    for (const el of track.current.querySelectorAll<HTMLElement>('[data-segment]')) {
      widest = Math.max(widest, el.scrollWidth)
    }
    setWidth(Math.max(widest + 24, MIN_SEGMENT))
  }, [scale, options])

  return (
    <div
      ref={track}
      role="tablist"
      aria-label={label}
      className="glim-well inline-flex flex-wrap gap-[0.2rem] p-[0.2rem]"
      style={{ borderRadius: 'var(--radius-control)', width: 'fit-content' }}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            data-segment
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            style={{
              borderRadius: 'calc(var(--radius-control) - 0.2rem)',
              width: scale === 'big' && width ? width : undefined,
              flex: 'none',
            }}
            className={[
              'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] font-medium transition-colors',
              // Inside a selector only the chosen segment is a badge. An idle
              // segment with a fill of its own is the per-segment badge an
              // unselected option must not be: the groove already does that job.
              active
                ? 'bg-accent text-accentContrast'
                : 'bg-transparent text-carbon-textMuted hover:bg-carbon-hover hover:text-carbon-text',
            ].join(' ')}
          >
            {o.icon && <span aria-hidden>{o.icon}</span>}
            <span>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
