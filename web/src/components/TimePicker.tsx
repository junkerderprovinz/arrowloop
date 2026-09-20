import { useEffect, useRef, useState } from 'react'

// An hour and a minute picked from two lists rather than a native time input,
// whose widget follows none of the engines. Minutes step by five, since a
// schedule is a cadence rather than an appointment.
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
 * Reads "HH:MM" back. A hand-edited value it cannot read falls back to 03:00
 * rather than throwing, so it stays editable.
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

  // Bound only while open, so a page full of these costs one listener.
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
      'shrink-0 px-3 py-1 text-xs tabular-nums transition-colors',
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
        className="inline-flex items-center gap-2 bg-carbon-surface2 px-3 py-2 text-xs tabular-nums text-carbon-text outline-none transition hover:brightness-110 focus:brightness-125"
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
          <span className="flex items-center px-0.5 text-xs text-carbon-textMuted" aria-hidden>
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
