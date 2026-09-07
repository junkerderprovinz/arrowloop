import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { attachNumberSteppers } from '../lib/numberField'
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
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-carbon-textMuted">
        {label}
        {hint && <InfoBubble tip={hint} />}
      </span>
      {children}
    </label>
  )
}

/**
 * The height every control in a row shares.
 *
 * It is a constant rather than a repeated class because it was NOT one, and
 * that cost a report: an input's height came out of its padding (py-2 on
 * text-xs is 32px) while the direction button between two of them was written
 * as h-9, which is 36. Nothing was wrong with either number on its own, and
 * side by side the button was visibly taller (jdp: "der button ist groesser als
 * die felder daneben").
 *
 * Naming it here does more than fix the four pixels: two controls that must
 * match can no longer be given two numbers by two people on two days. Anything
 * that sits in a row with a field takes THIS, and the guard in
 * Field.height.test.ts fails if a call site writes its own instead.
 *
 * It reads the --btn-h token rather than restating its value, and that is not
 * tidiness. The editor's name row holds its middle column open with a spacer
 * sized in --btn-h, to line that row up with the two sides below it. Written as
 * a plain h-8 this constant AGREED with the token by coincidence, and the first
 * change to either number would have quietly pulled two rows out of line
 * somewhere nobody was looking.
 */
export const CONTROL_H = 'h-[var(--btn-h)]'

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
      className={`w-full ${CONTROL_H} bg-carbon-surface2 px-3 text-xs text-carbon-text outline-none transition placeholder:text-carbon-textMuted focus:brightness-125 ${
        mono ? 'font-mono' : ''
      }`}
      style={{ borderRadius: 'var(--radius-control)' }}
    />
  )
}

/**
 * A number, with GlimStone's own steppers inside the box.
 *
 * The steppers are attached by the design language's own file rather than drawn
 * here, because that file exists precisely to stop each app inventing its own
 * pair: the rule was written twice and got it wrong once, and the working piece
 * is what carries the answer. The browser's native spinner is off by the same
 * token, in tokens.css.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  label?: string
}) {
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!box.current) return
    return attachNumberSteppers(box.current)
  }, [])

  return (
    <input
      ref={box}
      type="number"
      value={value}
      min={min}
      max={max}
      aria-label={label}
      onChange={(e) => {
        const next = parseInt(e.target.value, 10)
        // An empty box is a value being typed, not a value of zero. Passing NaN
        // up would write a schedule of "@every NaNh" the moment somebody
        // selects the digits to replace them.
        if (Number.isFinite(next)) onChange(next)
      }}
      className={`w-24 ${CONTROL_H} bg-carbon-surface2 px-3 text-xs text-carbon-text outline-none transition focus:brightness-125`}
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
      className="w-full resize-y bg-carbon-surface2 px-3 py-2 font-mono text-xs text-carbon-text outline-none transition placeholder:text-carbon-textMuted focus:brightness-125"
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
  roomy,
}: {
  value: T
  onChange: (next: T) => void
  /** `flag` is an ISO 3166-1 alpha-2 code, and only the language list has one. */
  options: { value: T; label: string; flag?: string }[]
  label?: string
  /**
   * One step up in text size, for a picker that is the whole point of its card
   * rather than one field among several in a form row.
   *
   * The language list is the case it was added for. jdp: "das sprach dropdown
   * ist zu klein bzw. die texte und flaggen" - and the flags were never sized
   * here at all: the sprite is 1.25em by 1em, so it is exactly as big as the
   * text beside it and shrinks with it. One size decides both, which is why
   * there is one switch and not two.
   *
   * BombVault's own language card is the reference, opened rather than guessed
   * at: text-sm with gap-2.5, and its trigger stays the same 32px tall, because
   * py-1.5 on a 20px line box comes to the same height as the form rows do at
   * py-2 on a 16px one. So this changes the reading size and nothing about how
   * the control lines up.
   */
  roomy?: boolean
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
        className={`flex w-full ${CONTROL_H} items-center ${roomy ? 'gap-2.5' : 'gap-2'} bg-carbon-surface2 pl-3 pr-8 text-start ${roomy ? 'text-sm' : 'text-xs'} text-carbon-text outline-none transition hover:bg-carbon-hover focus-visible:brightness-125`}
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
            className={`flex w-full items-center ${roomy ? 'gap-2.5' : 'gap-2'} px-3 py-2 text-start ${roomy ? 'text-sm' : 'text-xs'} transition-colors ${
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
        className={`w-full ${CONTROL_H} bg-carbon-surface2 pl-3 pr-9 font-mono text-xs text-carbon-text outline-none transition placeholder:font-sans placeholder:text-carbon-textMuted focus:brightness-125`}
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
