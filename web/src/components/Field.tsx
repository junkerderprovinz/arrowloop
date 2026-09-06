import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { enableSelectScroll } from '../lib/selectScroll'
import { useT } from '../lib/i18n'
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
