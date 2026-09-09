import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import { hueVars, rainbowAt } from '../lib/appearance'
import { groupStage } from '../lib/controls'
import { useRainbow } from './Shell'

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
export type Option<T extends string> = { value: T; label: string; icon?: ReactNode }

/**
 * The app-wide floor for a big selector's segments.
 *
 * One constant, so that three page-level strips with three different longest
 * labels still render as one recurring control rather than three unrelated
 * ones. `Math.max` keeps it a FLOOR and never a cap: a locale whose longest
 * label genuinely needs more gets exactly that, because clamping a segment
 * below its own content is how a label ends up truncated.
 *
 * The number matches BombVault's `MIN_PINNED_WIDTH`, which is where this
 * measurement was worked out first. Two apps in the same house whose strips
 * are pinned to two different floors is the drift a shared constant exists to
 * prevent, and there is no reason for this one to be its own value.
 */
const MIN_SEGMENT = 200

export function Selector<T extends string>({
  options,
  value,
  onChange,
  scale = 'big',
  variant = 'well',
  label,
}: {
  options: Option<T>[]
  value: T
  onChange: (next: T) => void
  scale?: 'big' | 'small'
  /**
   * Which of the two shapes this control has, and they are NOT interchangeable.
   *
   * `well` is a groove holding keys: one track with its own fill, idle segments
   * transparent against it, only the chosen one filled. That is a selector, and
   * it is what everything in this app was.
   *
   * `chip` has no track at all. Every segment carries its own fill and the
   * chosen one carries the accent, so the row reads as a bar of tabs sitting on
   * the page rather than as one control with a slot in it.
   *
   * The distinction is BombVault's, arrived at there the hard way and copied
   * from its file rather than from the rule: its small selectors were once
   * given per-segment fills and jdp rejected that ("die nicht ausgewaehlten
   * Optionen sollen kein Badge sein"), while its settings tab strip was once
   * given the groove look and he rejected THAT too. Both are right, because
   * they are two different controls that happen to share an implementation.
   * jdp on this app: "die tabs sollen tabs sein, kein horizontaler selektor",
   * and then again after the first attempt only made the groove version bigger.
   */
  variant?: 'well' | 'chip'
  label?: string
}) {
  const track = useRef<HTMLDivElement>(null)

  // The stage comes from the LABELS, not from what is rendered, which is what
  // lets the strip keep its width when the label engine hides the words. A
  // measurement of the drawn content would shrink the moment they went away,
  // and switching a display mode would reflow the page.
  const stage = useMemo(() => groupStage(options.map((o) => o.label)), [options])

  // A primitive, not the options array itself. Every caller builds that array
  // inline, so a new identity on each render says nothing about whether the
  // LABELS changed; using it as a dependency re-runs the measurement on every
  // unrelated render of the page around it. Two strings with the same
  // characters compare equal even when freshly built, so this stays stable
  // across renders unless a label really changed, such as on a language switch.
  //
  // The separator is a newline rather than nothing, so that two label sets that
  // concatenate to the same characters are still told apart.
  const labelKey = options.map((o) => o.label).join('\n')

  // The width is a real measurement, never a guessed pixel value: it has to
  // follow the label set, the font and the locale. A flex share cannot do this
  // job, because a flex item whose basis resolves to zero contributes zero to
  // a shrink-to-fit parent, which truncates the widest label the moment nothing
  // stretches the track.
  const [width, setWidth] = useState<number | null>(null)

  // Pass 1: drop any width already applied, whenever the label set changes.
  //
  // This half is not tidiness, it is the whole correctness of the measurement.
  // A segment currently carrying an explicit width has no overflow, so
  // measuring it reports that applied width straight back rather than the
  // content's natural size. A single-pass version therefore measured its own
  // previous answer and added the padding allowance to it again on every pass,
  // and the strip grew by that allowance on every click, for as long as
  // somebody kept clicking. Found by jdp on the running interface, not by a
  // test: nothing here is wrong until the second render, and a test that
  // renders once sees a perfectly correct strip.
  useLayoutEffect(() => {
    if (scale === 'big') setWidth(null)
  }, [scale, labelKey])

  // Pass 2: with the segments back at their natural width, measure the widest
  // and pin them all to it. Skipped once a width is set, because there is
  // nothing to measure again until pass 1 clears it.
  //
  // Both passes are layout effects, so the unpinned render and the pinned one
  // both commit before the browser paints and nothing flickers between them.
  useLayoutEffect(() => {
    if (scale !== 'big' || width !== null || !track.current) return
    let widest = 0
    for (const el of track.current.querySelectorAll<HTMLElement>('[data-segment]')) {
      widest = Math.max(widest, el.getBoundingClientRect().width)
    }
    if (widest === 0) return

    // The floor is a floor and not a promise the row can always keep. A
    // four-option strip at 200px each needs 800px, and inside a card in a
    // reading-width column there is not that much, so the last segment wrapped
    // onto a line of its own and the control read as broken. What the eye wants
    // here is one row, not a uniform width bought with a fold.
    //
    // So the pin is capped at the share of the space this strip actually HAS.
    // With room, every strip in the app still lands on the same width and the
    // floor does its job; without room, the segments shrink together and the
    // row stays a row. Measured off the parent, because the track itself is
    // fit-content and would report the sum it is trying to avoid.
    const parent = track.current.parentElement
    const room = parent ? parent.getBoundingClientRect().width : 0
    const gaps = 0.2 * 16 * (options.length + 1)
    const share = room > 0 ? (room - gaps) / options.length : Number.POSITIVE_INFINITY
    setWidth(Math.min(Math.max(widest, MIN_SEGMENT), Math.max(widest, share)))
  }, [scale, width, labelKey, options.length])

  // Subscribed, because every segment below reads a rainbow position. Without
  // it, turning the mode on repaints the cards and leaves every strip on the
  // old accent until something else happens to re-render.
  useRainbow()

  return (
    <div
      ref={track}
      role="tablist"
      aria-label={label}
      className={
        variant === 'well'
          ? 'glim-well inline-flex flex-wrap gap-[0.2rem] p-[0.2rem]'
          : // No track, so no padding and no fill of its own. The gap is wider
            // than the well's 0.2rem ring because it is a gap BETWEEN chips
            // rather than the groove showing around them.
            'inline-flex flex-wrap gap-1'
      }
      style={{
        borderRadius: variant === 'well' ? 'var(--radius-control)' : undefined,
        width: 'fit-content',
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
              // Every segment takes its OWN position in the palette, so a
              // three-way picker reads as three colours rather than one accent
              // and two greys. This was missing, and it is the difference jdp
              // named in BombVault in the strongest terms available: a control
              // left out of the colour engine is a control that looks like a
              // different app the moment the mode goes on. The position sits on
              // the segment rather than the track, because `.glim-hue` rebinds
              // the accent for its whole subtree and the fill, the ink and the
              // focus ring all have to move together.
              ...(hueVars(rainbowAt(i)) as CSSProperties),
              // The FULL control radius, not the track's minus the padding.
              // Subtracting the well's 0.2rem looks like the careful thing and
              // is what made the strip read as square: at the Soft stage the
              // control radius is 5px, so a segment kept 1.8px of it and every
              // horizontal selector in the app looked barely rounded. Reported
              // as exactly that. BombVault's segments carry `rounded-control`
              // whole, and its own comment says so; the segments sit inside a
              // track that is rounded the same amount, which is what makes the
              // pair read as one control rather than as a box in a box.
              borderRadius: 'var(--radius-control)',
              width: scale === 'big' && width ? width : undefined,
              minWidth: scale === 'big' ? undefined : `calc(var(--btn-w-${stage}) / ${options.length})`,
              flex: 'none',
            }}
            className={[
              'glim-hue glim-hue-icon glim-tab inline-flex items-center justify-center gap-1.5 px-3',
              // The badge height token, not padding. Two strips whose segments
              // are a pixel apart in height read as two different controls, and
              // padding plus a font size is two ways to arrive at a height that
              // only agree by accident.
              'h-[var(--badge-md)] text-xs font-medium',
              '[transition:background-color_120ms_ease]',
              // Inside a selector only the chosen segment is a badge. An idle
              // segment with a fill of its own is the per-segment badge an
              // unselected option must not be: the groove already does that job.
              active
                ? 'glim-active bg-accent text-accentContrast'
                : variant === 'well'
                  ? 'bg-transparent text-carbon-textSub hover:bg-carbon-hover hover:text-carbon-text'
                  : // A chip carries its own fill even when it is not chosen,
                    // because there is no groove behind it to say it is a
                    // control. This is the one place the "an unselected option
                    // is never a badge" rule does not apply, and it does not
                    // apply because the rule is about a segment inside a track.
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
