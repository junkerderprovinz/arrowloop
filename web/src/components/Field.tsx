import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { enableSelectScroll } from '../lib/selectScroll'
import { useT } from '../lib/i18n'
import { IconHidden, IconVisible } from './glyphs'

/**
 * An explanation lives in a bubble, never on the page.
 *
 * Grey prose under a control is read once, by one person, on the day it was
 * written, and then costs that vertical space for the rest of the product's
 * life. A page of those hides the controls anybody actually came for.
 *
 * The icon is a bare stroke-only glyph and never a filled badge: a fill would
 * read as a control, and it is furniture.
 */
export function Info({ text }: { text: string }) {
  return (
    <button
      type="button"
      data-tip={text}
      aria-label={text}
      className="glim-info-icon inline-flex shrink-0 items-center justify-center align-middle"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <circle cx="8" cy="8" r="6.4" />
        <path d="M8 7.2v4" strokeLinecap="round" />
        <circle cx="8" cy="4.9" r="0.85" fill="currentColor" stroke="none" />
      </svg>
    </button>
  )
}

/**
 * One labelled control.
 *
 * A `<label>` around several controls hands its click to the first one, so this
 * is deliberately for exactly one; a set of them needs a plain container with a
 * caption instead.
 */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-carbon-textMuted">
        {label}
        {hint && <Info text={hint} />}
      </span>
      {children}
    </label>
  )
}

/**
 * Form fields are borderless and filled, and focus is a brightness step rather
 * than a ring. A box drawn around every input is hierarchy from borders, which
 * is the thing this design language spends most of its rules avoiding.
 */
export function Text({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full bg-carbon-surface2 px-3 py-2 text-[12px] text-carbon-text outline-none transition placeholder:text-carbon-textMuted focus:brightness-125 ${
        mono ? 'font-mono' : ''
      }`}
      style={{ borderRadius: 'var(--radius-control)' }}
    />
  )
}

/** The same, for a value that runs to several lines. */
export function Lines({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-y bg-carbon-surface2 px-3 py-2 font-mono text-[12px] text-carbon-text outline-none transition placeholder:text-carbon-textMuted focus:brightness-125"
      style={{ borderRadius: 'var(--radius-control)' }}
    />
  )
}

/**
 * A switch, never a checkbox.
 *
 * The label comes FIRST and the track sits at the end of the row. Every other
 * program in this house reads that way, and a switch strip that leads with the
 * track is the one thing on the page whose reading order is reversed: the eye
 * lands on a shape that means nothing yet, then travels to the word that
 * explains it, for every row. Reported on the running interface rather than
 * spotted in review, which is where an ordering like this is actually visible.
 *
 * `justify-between` rather than a gap, so a column of switches has every track
 * on the same vertical line no matter how long the individual captions are.
 * A ragged right edge is what makes a settings card read as a list of unrelated
 * rows instead of one control group.
 *
 * The fill is the accent, the same as everywhere else in the house. An earlier
 * version filled it with the text colour, reasoning that the accent marks
 * activity and a settings row is not activity; that argument is coherent and it
 * still left this app's switches looking like nobody else's.
 */
export function Switch({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-[12px]">
        {label}
        {hint && <Info text={hint} />}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={`inline-flex h-5 w-9 shrink-0 items-center p-[3px] transition-colors ${
          on ? 'bg-accent' : 'bg-carbon-surface3'
        }`}
        style={{ borderRadius: 'var(--radius-pill)' }}
      >
        {/* The knob wears the shape engine's own radius rather than a hardcoded
            circle, so it reshapes with every other surface in the app. */}
        <span
          className={`h-3.5 w-3.5 bg-carbon-background transition-transform ${on ? 'translate-x-4' : ''}`}
          style={{ borderRadius: 'var(--radius-pill)' }}
        />
      </button>
    </div>
  )
}

/**
 * A list with more entries than a segmented control can carry.
 *
 * This is a native select on purpose: the design language keeps one for lists
 * of dozens, because a hand-built listbox has to reimplement keyboard
 * behaviour, type-ahead and the platform's own scrolling, and gets all three
 * slightly wrong. What is NOT native is the way it looks. A control that still
 * renders in the operating system's own light chrome inside a dark page is as
 * unfinished as one with no colours at all, so the field, the arrow and the
 * options are all painted from the tokens.
 */
export function Choice<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (next: T) => void
  options: { value: T; label: string }[]
  label?: string
}) {
  const box = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    if (box.current) enableSelectScroll(box.current)
  }, [])

  return (
    <div className="relative">
      <select
        ref={box}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full appearance-none bg-carbon-surface2 py-2 pl-3 pr-8 text-[12px] text-carbon-text outline-none transition focus:brightness-125"
        style={{ borderRadius: 'var(--radius-control)', colorScheme: 'inherit' }}
      >
        {options.map((o) => (
          // The option list is drawn by the platform, and several of them read
          // these two properties rather than the ones on the select. Setting
          // them here is what stops the open list arriving white.
          <option
            key={o.value}
            value={o.value}
            style={{ background: 'var(--carbon-surface2)', color: 'var(--carbon-text)' }}
          >
            {o.label}
          </option>
        ))}
      </select>
      {/* The arrow the appearance reset removed. Drawn rather than a glyph, so
          it follows the text colour in every theme. */}
      <svg
        aria-hidden
        width="10"
        height="10"
        viewBox="0 0 10 10"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-carbon-textMuted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M2 4l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/**
 * A field holding a secret, with its show and hide control inside it.
 *
 * The eye is furniture rather than a control: a bare glyph the field's own
 * trailing padding reserves room for, neutral rather than accented, because it
 * means "look" and not "activity". It does not change the field's width either,
 * or secret fields would read as narrower than every other field, which is the
 * one thing the eye should not draw attention to.
 */
export function Secret({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
}) {
  const [shown, setShown] = useState(false)
  const { t } = useT()
  const label = shown ? t('secret.hide') : t('secret.show')

  return (
    <div className="relative w-full">
      <input
        type={shown ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-carbon-surface2 py-2 pl-3 pr-9 font-mono text-[12px] text-carbon-text outline-none transition placeholder:font-sans placeholder:text-carbon-textMuted focus:brightness-125"
        style={{ borderRadius: 'var(--radius-control)' }}
      />
      <button
        type="button"
        onClick={() => setShown((was) => !was)}
        title={label}
        data-tip={label}
        aria-label={label}
        aria-pressed={shown}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-carbon-textMuted transition hover:text-carbon-text"
      >
        {shown ? <IconHidden /> : <IconVisible />}
      </button>
    </div>
  )
}
