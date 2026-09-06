import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { DropdownListbox } from '../lib/glimstone/DropdownListbox'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { useT } from '../lib/i18n'
import { Flag } from './Flag'
import { IconHidden, IconVisible } from './glyphs'

/**
 * A labelled field: the eyebrow above, the control below.
 *
 * The explanation rides in GlimStone's own info bubble rather than in a grey
 * paragraph, and the bubble is imported rather than drawn here. This file used
 * to carry its own copy, which is precisely the dialect the language's React
 * folder exists to end.
 */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-carbon-textMuted">
        {label}
        {hint && <InfoBubble tip={hint} />}
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
 * A picker: a button that opens GlimStone's own listbox.
 *
 * It was a native `<select>` until 2026-09-07, which the design language calls
 * the default rather than the rule, and names the ceiling it runs into: a native
 * select's closed height and its open list's row padding are both drawn by the
 * operating system, so neither can be styled, and its open list is not page DOM
 * at all. Reported as exactly that ("das drop down war auch nicht im GSS") and
 * it was right: everything else on the settings page came from the language, and
 * this one control came from the platform.
 *
 * Two things follow from the change rather than one. The panel is now the same
 * portalled, edge-aware listbox every other picker in the house uses, and its
 * rows are ordinary elements, so an option can hold a real flag rather than the
 * two-letter tag Windows draws for the emoji a native option was limited to.
 *
 * All four pickers in this app go through here, so none of them is left behind
 * as a second, differently-drawn version of the same control.
 */
export function Choice<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (next: T) => void
  /** `flag` is an ISO 3166-1 alpha-2 code, and only the language list has one. */
  options: { value: T; label: string; flag?: string }[]
  label?: string
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-carbon-surface2 py-2 pl-3 pr-8 text-start text-[12px] text-carbon-text outline-none transition hover:bg-carbon-hover focus-visible:brightness-125"
        style={{ borderRadius: 'var(--radius-control)' }}
      >
        {current?.flag && <Flag code={current.flag} />}
        {/* The row must not grow with its content: forty-two locale names go
            through here, and the longest of them would otherwise decide how wide
            the field is. */}
        <span className="min-w-0 flex-1 truncate">{current?.label ?? ''}</span>
      </button>

      {/* Drawn rather than a glyph, so it follows the text colour in every
          theme. It sits on the button rather than inside it so the button's own
          flex row never has to reserve space for it. */}
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

      <DropdownListbox open={open} onClose={() => setOpen(false)} triggerRef={trigger} label={label ?? ''}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={o.value === value}
            onClick={() => {
              onChange(o.value)
              setOpen(false)
            }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-start text-[12px] transition-colors ${
              o.value === value
                ? 'bg-carbon-surface3 text-carbon-text'
                : 'text-carbon-textSub hover:bg-carbon-hover hover:text-carbon-text'
            }`}
          >
            {o.flag && <Flag code={o.flag} />}
            <span className="min-w-0 truncate">{o.label}</span>
          </button>
        ))}
      </DropdownListbox>
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
