import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

import { enableSelectScroll } from '../lib/selectScroll'

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
 * The accent marks activity, and a row of settings switches is not activity, so
 * an on switch is filled with the text colour rather than the accent. That
 * keeps the one accent on a page for the thing that is actually happening.
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
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={`inline-flex h-4 w-7 shrink-0 items-center p-0.5 transition-colors ${
          on ? 'bg-carbon-text' : 'bg-carbon-surface3'
        }`}
        style={{ borderRadius: 'var(--radius-pill)' }}
      >
        <span
          className={`h-3 w-3 bg-carbon-background transition-transform ${on ? 'translate-x-3' : ''}`}
          style={{ borderRadius: 'var(--radius-pill)' }}
        />
      </button>
      <span className="flex items-center gap-1.5 text-[12px]">
        {label}
        {hint && <Info text={hint} />}
      </span>
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
