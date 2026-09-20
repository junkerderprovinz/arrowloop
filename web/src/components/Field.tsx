import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { attachNumberSteppers } from '../lib/numberField'
import { enableWheelStep, stepIndex } from '../lib/selectScroll'
import { DropdownListbox } from '../lib/glimstone/DropdownListbox'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { useT } from '../lib/i18n'
import { Flag } from './Flag'
import { IconHidden, IconVisible } from './glyphs'

/** A labelled field: the eyebrow and its info bubble above, the control below. */
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
 * The height every control in a row with a field shares; Field.height.test.ts
 * fails if a call site writes its own. It reads --btn-h because the editor's
 * name row lines up with a spacer sized in that token.
 */
export const CONTROL_H = 'h-[var(--btn-h)]'

/**
 * GlimStone's one step up, for the control a surface exists for: the button
 * that creates a job and the direction switch. In a field row it is centred
 * against its neighbours rather than top-aligned.
 */
export const KEY_CONTROL_H = 'h-[var(--btn-h-key)]'

/** A borderless, filled text box; focus is a brightness step rather than a ring. */
export function Text({
  value,
  onChange,
  placeholder,
  mono,
  label,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  mono?: boolean
  /** The accessible name for a box that stands outside a Field. */
  label?: string
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full ${CONTROL_H} bg-carbon-surface2 px-3 text-xs text-carbon-text outline-none transition placeholder:text-carbon-textMuted focus:brightness-125 ${
        mono ? 'font-mono' : ''
      }`}
      style={{ borderRadius: 'var(--radius-control)' }}
    />
  )
}

/**
 * A calendar day, as `YYYY-MM-DD`. The browser's own date box shows and takes
 * the day in the reader's locale order while the value stays ISO.
 */
export function Day({
  value,
  onChange,
  label,
  max,
}: {
  value: string
  onChange: (next: string) => void
  label: string
  /** An upper bound, to stop a range being drawn into next year. */
  max?: string
}) {
  return (
    <input
      type="date"
      value={value}
      max={max}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className={`${CONTROL_H} bg-carbon-surface2 px-3 text-xs text-carbon-text outline-none transition focus:brightness-125`}
      style={{ borderRadius: 'var(--radius-control)' }}
    />
  )
}

/** A number, with GlimStone's steppers inside the box. */
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
        // An empty box is a value being typed; passing NaN up would write a
        // schedule of "@every NaNh".
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
 * A picker: a button that opens GlimStone's listbox, used by every picker in
 * the app. Unlike a native `<select>` it can be styled and its options can hold
 * a real flag. Like one, a wheel roll over the closed control steps its value.
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
   * One step up in text size, for a picker that is its card's main control,
   * such as the language list. The flag sprite is sized in em, so it grows with
   * the text; the height stays that of the form rows.
   */
  roomy?: boolean
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)

  // Call sites build their options inline, so the wheel listener reads them
  // through a ref instead of re-attaching on every render.
  const latest = useRef({ options, value, onChange })
  latest.current = { options, value, onChange }
  useEffect(() => {
    const el = trigger.current
    if (!el) return
    return enableWheelStep(el, (delta) => {
      const now = latest.current
      const at = now.options.findIndex((o) => o.value === now.value)
      const next = stepIndex(now.options.length, at < 0 ? 0 : at, delta)
      const landed = now.options[next]
      if (landed && landed.value !== now.value) now.onChange(landed.value)
    })
  }, [])

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full ${CONTROL_H} items-center ${roomy ? 'gap-2.5' : 'gap-2'} bg-carbon-surface2 pl-3 pr-8 text-start ${roomy ? 'text-sm' : 'text-xs'} text-carbon-text outline-none transition hover:bg-carbon-surface3 focus-visible:brightness-125`}
        style={{ borderRadius: 'var(--radius-control)' }}
      >
        {current?.flag && <Flag code={current.flag} />}
        {/* Truncated, or the longest locale name would decide the field's width. */}
        <span className="min-w-0 flex-1 truncate">{current?.label ?? ''}</span>
      </button>

      {/* Outside the button, so its flex row reserves no space for the chevron. */}
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
 * A field holding a secret, with a neutral show and hide eye inside its
 * trailing padding so it keeps the width of every other field.
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
