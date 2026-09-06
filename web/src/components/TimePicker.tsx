import { useEffect, useRef, useState } from 'react'

/**
 * An hour and a minute, picked rather than typed.
 *
 * A native `<input type="time">` is the obvious answer and it is the wrong one
 * twice over: it renders the operating system's own widget inside a surface
 * that follows none of the engines, and it asks somebody to type a time when
 * every value it accepts is a short list. So the trigger is read-only text in a
 * field's own clothing, and the popover holds two scrollable lists.
 *
 * The minute column steps rather than offering sixty rows. A schedule in this
 * program is a cadence, not an appointment: nobody needs a sync at 03:47, and a
 * list of sixty is a list nobody scrolls to the end of.
 */
const MINUTE_STEP = 5

export function minutes(step = MINUTE_STEP): number[] {
  const out: number[] = []
  for (let m = 0; m < 60; m += step) out.push(m)
  return out
}

export const hours: number[] = Array.from({ length: 24 }, (_, i) => i)

/** "HH:MM", with both halves padded, which is the only form the parser accepts. */
export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * Reads "HH:MM" back, falling back to a sensible hour rather than throwing.
 *
 * A stored value can be anything: a hand-edited configuration file, a schedule
 * written before this picker existed. Refusing to render is the one behaviour
 * that would make such a value uneditable, which is the opposite of what an
 * editor is for.
 */
export function parseTime(value: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim())
  if (!m) return { hour: 3, minute: 0 }
  const hour = Math.min(23, Math.max(0, parseInt(m[1], 10)))
  const minute = Math.min(59, Math.max(0, parseInt(m[2], 10)))
  return { hour, minute }
}

/** The nearest offered minute, so a stored 03:47 still highlights a row. */
export function nearestStep(options: number[], n: number): number {
  let best = options[0]
  for (const o of options) {
    if (Math.abs(o - n) < Math.abs(best - n)) best = o
  }
  return best
}

export function TimePicker({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (next: string) => void
  label: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const { hour, minute } = parseTime(value)
  const steps = minutes()
  const shownMinute = nearestStep(steps, minute)

  // Closing on an outside press and on Escape, both of which somebody expects
  // from anything that floats. Bound only while open, so a page full of these
  // costs one listener rather than one per field.
  useEffect(() => {
    if (!open) return
    function away(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const column =
    'glim-time-col flex max-h-44 flex-col gap-0.5 overflow-y-auto p-1'

  function option(active: boolean) {
    return [
      'shrink-0 px-3 py-1 text-[12px] tabular-nums transition-colors',
      active
        ? 'bg-accent text-accentContrast'
        : 'text-carbon-textMuted hover:bg-carbon-hover hover:text-carbon-text',
    ].join(' ')
  }

  return (
    <div className="relative inline-block" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${formatTime(hour, shownMinute)}`}
        className="inline-flex items-center gap-2 bg-carbon-surface2 px-3 py-2 text-[12px] tabular-nums text-carbon-text outline-none transition hover:brightness-110 focus:brightness-125"
        style={{ borderRadius: 'var(--radius-control)' }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
          <circle cx="8" cy="8" r="6.4" />
          <path d="M8 4.6V8l2.4 1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {formatTime(hour, shownMinute)}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="glim-fade absolute left-0 top-full z-30 mt-1 flex bg-carbon-surface3 p-1 shadow-lg"
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <ul role="listbox" aria-label={label} className={column}>
            {hours.map((h) => (
              <li key={h}>
                <button
                  type="button"
                  role="option"
                  aria-selected={h === hour}
                  onClick={() => onChange(formatTime(h, shownMinute))}
                  className={`w-full ${option(h === hour)}`}
                  style={{ borderRadius: 'var(--radius-control)' }}
                >
                  {String(h).padStart(2, '0')}
                </button>
              </li>
            ))}
          </ul>
          <span className="flex items-center px-0.5 text-[12px] text-carbon-textMuted" aria-hidden>
            :
          </span>
          <ul role="listbox" aria-label={label} className={column}>
            {steps.map((m) => (
              <li key={m}>
                <button
                  type="button"
                  role="option"
                  aria-selected={m === shownMinute}
                  onClick={() => {
                    onChange(formatTime(hour, m))
                    setOpen(false)
                  }}
                  className={`w-full ${option(m === shownMinute)}`}
                  style={{ borderRadius: 'var(--radius-control)' }}
                >
                  {String(m).padStart(2, '0')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
