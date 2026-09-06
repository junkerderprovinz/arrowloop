import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { hueVars, rainbowColor, subscribeRainbow } from '../lib/appearance'

/**
 * Re-render when the rainbow changes.
 *
 * The palette, the rotation and whether the mode is on at all are held outside
 * React, because they are set on the document root and read by CSS. Anything
 * that asks for a colour has to be woken when they change, or turning the mode
 * on paints the cards and leaves every badge inside them on the old accent
 * until something else happens to re-render.
 */
export function useRainbow(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeRainbow(() => setVersion((v) => v + 1)), [])
  return version
}

/**
 * A card is the only raised surface in the whole interface (design language,
 * rule 1). Never nest one inside another: group content with spacing and a
 * section title instead.
 *
 * The title is a filled badge overlapping the card's top edge, never bare text
 * (rule 11), and a section badge is always coloured because it is a heading
 * rather than a control.
 */
export function Card({
  title,
  actions,
  hue,
  children,
}: {
  title?: string
  actions?: ReactNode
  /**
   * This card's position in the palette.
   *
   * The position belongs on the CONTAINER and never on the one coloured thing
   * inside it. Give a card its position and its title badge, its switches, its
   * buttons and its focus ring all follow, because the rule under `.glim-hue`
   * rebinds the accent for the whole subtree. Putting it on the badge instead
   * leaves every control in the card on the single accent, which is the mode
   * looking broken while being technically on.
   */
  hue?: number
  children: ReactNode
}) {
  useRainbow()
  return (
    <section
      className={`glim-card relative px-5 pb-5 pt-7 ${hue === undefined ? "" : "glim-hue"}`}
      style={hue === undefined ? undefined : hueVars(rainbowColor(hue))}
    >
      {title && (
        <div className="absolute -top-3 left-5 flex items-center gap-2">
          <SectionTitle>{title}</SectionTitle>
        </div>
      )}
      {actions && <div className="absolute -top-3 right-5 flex items-center gap-2">{actions}</div>}
      {children}
    </section>
  )
}

/** The filled section badge from rule 11. Always coloured, never a bare label. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center bg-accent px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-accentContrast"
      style={{ borderRadius: 'var(--radius-pill)' }}
    >
      {children}
    </span>
  )
}

/**
 * Cards stack on one shared rhythm of 40px (rule 20). A smaller gap reads as
 * cramped once every card carries a title badge overlapping its top edge.
 */
export function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-10">{children}</div>
}

/** The four state hues, and there is never a fifth (rule 4). */
export type Tone = 'accent' | 'ok' | 'fail' | 'neutral'

const toneClass: Record<Tone, string> = {
  accent: 'bg-accent text-accentContrast',
  ok: 'bg-statusOkBg text-statusOk',
  fail: 'bg-statusFailBg text-statusFail',
  neutral: 'bg-statusNeutralBg text-statusNeutral',
}

/** Everything that carries a state is a badge (rules 4 and 13). */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap px-2.5 py-1 text-[11px] font-medium ${toneClass[tone]}`}
      style={{ borderRadius: 'var(--radius-pill)' }}
    >
      {children}
    </span>
  )
}

/**
 * Everything clickable is a badge, including links (rule 13). A page has at
 * most one solid accent button, because the accent marks activity and nothing
 * else (rule 3) — so `primary` is a claim, not a style, and only one place on
 * a screen gets to make it.
 */
export function Button({
  children,
  onClick,
  primary,
  disabled,
  title,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  primary?: boolean
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
}) {
  const look = primary
    ? 'bg-accent text-accentContrast hover:brightness-110'
    : 'bg-carbon-surface2 text-carbon-text hover:bg-carbon-hover'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-tip={title}
      className={`glim-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${look}`}
      style={{ borderRadius: 'var(--radius-pill)' }}
    >
      {children}
    </button>
  )
}

/**
 * Digits that change or stack use tabular figures (rule 7), so a count does not
 * jitter sideways while it counts.
 */
export function Num({ children }: { children: ReactNode }) {
  return <span className="glim-num">{children}</span>
}

/** A hairline separator. Hierarchy comes from type and colour step, so this is
 *  as much of a line as the design language allows (rule 5). */
export function Rule() {
  return <div className="h-px w-full" style={{ background: 'var(--hairline)' }} />
}

/**
 * The empty state. A list with nothing in it still has to say what it is and
 * why it is empty, or it reads as a page that failed to load.
 */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-[12px] text-carbon-textMuted">{children}</p>
}

/**
 * A small, single-purpose action: an icon, never a text label.
 *
 * "Copy" or "Delete" sitting in its own pill beside three icon-only controls
 * reads as a stray caption and costs the row width a label does not need to
 * spend. The name survives as the hover bubble and as the accessible name, so
 * nothing is lost but the ink.
 */
export function IconButton({
  children,
  onClick,
  title,
  disabled,
  tone = 'neutral',
}: {
  children: ReactNode
  onClick?: () => void
  title: string
  disabled?: boolean
  tone?: Tone
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-tip={title}
      aria-label={title}
      className={`inline-flex h-7 w-7 items-center justify-center transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClass[tone]} hover:brightness-110`}
      style={{ borderRadius: 'var(--radius-pill)' }}
    >
      {children}
    </button>
  )
}

/**
 * The secondary actions of one row, revealed on hover.
 *
 * A long list reads as content, not as a wall of buttons. The row's primary
 * action stays outside this and is always visible.
 *
 * The group survives being hovered, because it is the pointer entering the ROW
 * that reveals it, not the pointer entering the buttons: a control that
 * disappears the moment somebody reaches for it is worse than one that was
 * never hidden. Keyboard focus reveals it too, or the buttons would be
 * reachable by tab and invisible while focused.
 */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
      {children}
    </div>
  )
}
