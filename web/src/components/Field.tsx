import type { ReactNode } from 'react'

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
