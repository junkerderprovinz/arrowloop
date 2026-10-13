import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { IconSchedules } from './glyphs'
import { describeCadence, readCadence } from '../lib/cadence'
import { computeBubblePosition } from '../lib/glimstone/bubblePosition'
import { usePortalHue } from '../lib/glimstone/portalHue'
import { useT } from '../lib/i18n'

/** The gap between the button and the panel, as under the time picker. */
const GAP = 4

/**
 * A schedule shown as its sentence on a button, which opens the schedule's
 * editor in a panel anchored to it (GlimStone, "A schedule is edited from its
 * sentence"). Nobody has to read a cron expression to learn when a job runs,
 * and the editor still offers the cron field for one typed by hand.
 */
export function ScheduleButton({
  label,
  value,
  watch = false,
  children,
}: {
  /** What the schedule is for. It names the panel and goes before the sentence for a screen reader. */
  label: string
  value: string
  /** Real time, which the expression cannot say. */
  watch?: boolean
  /** The editor. */
  children: ReactNode
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const sentence = describeCadence(readCadence(value, watch), t)

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-schedule-sentence
        onClick={() => setOpen((was) => !was)}
        className="inline-flex min-h-9 min-w-0 max-w-full items-center gap-2 bg-carbon-surface2 px-3 py-1.5 text-start text-body text-carbon-text outline-none transition hover:bg-carbon-surface3 focus-visible:brightness-125"
        style={{ borderRadius: 'var(--radius-control)' }}
      >
        <span className="inline-flex shrink-0 text-accentText">
          <IconSchedules />
        </span>
        <span className="sr-only">{label}: </span>
        <span className="block min-w-0 break-words first-letter:uppercase">{sentence}</span>
      </button>
      {open && (
        <Panel label={label} trigger={trigger} onClose={() => setOpen(false)}>
          {children}
        </Panel>
      )}
    </>
  )
}

function Panel({
  label,
  trigger,
  onClose,
  children,
}: {
  label: string
  trigger: RefObject<HTMLButtonElement | null>
  onClose: () => void
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const hue = usePortalHue(true, trigger)
  const close = useRef(onClose)
  close.current = onClose

  // Placed again whenever the page under it moves or the editor changes size,
  // since a mode with more rows makes the panel taller.
  useLayoutEffect(() => {
    function place() {
      const at = trigger.current?.getBoundingClientRect()
      const box = panel.current
      if (!at || !box) return
      const { left, top } = computeBubblePosition(
        at,
        { width: box.offsetWidth, height: box.offsetHeight },
        {
          width: document.documentElement.clientWidth || window.innerWidth,
          height: document.documentElement.clientHeight || window.innerHeight,
        },
        GAP,
      )
      setPos((was) => (was && was.left === left && was.top === top ? was : { left, top }))
    }
    place()
    const sized = new ResizeObserver(place)
    if (panel.current) sized.observe(panel.current)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      sized.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [trigger])

  useEffect(() => {
    // A list the editor opens is portalled to the body as well, so a press in
    // it is not a press outside.
    function away(e: MouseEvent) {
      const target = e.target as Element
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return
      if (target.closest?.('[role="listbox"]')) return
      close.current()
    }
    // Captured, so the window this panel may sit in does not close on the same
    // Escape. An open list inside takes it first.
    function key(e: KeyboardEvent) {
      if (e.key !== 'Escape' || document.querySelector('[role="listbox"]')) return
      e.stopPropagation()
      close.current()
      trigger.current?.focus()
    }
    document.addEventListener('mousedown', away)
    window.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', key, true)
    }
  }, [trigger])

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      className={`glim-fade fixed z-50 w-[min(94vw,34rem)] bg-carbon-surface p-4 shadow-xl ${hue.className}`}
      style={{
        ...hue.style,
        borderRadius: 'var(--radius-card)',
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        transform: 'translateX(-50%)',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
