import { useCallback, useState, type ReactNode } from 'react'

import { ToggleRow } from './ToggleRow'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { useT } from '../lib/i18n'

/**
 * A counter that goes up each time somebody reaches for a field the switch
 * holds. The switch is keyed on it, so every attempt replays its wiggle.
 */
export function useNudge(): [number, () => void] {
  const [nudged, setNudged] = useState(0)
  return [nudged, useCallback(() => setNudged((n) => n + 1), [])]
}

/**
 * The job window's one switch: on, the job takes every setting that has a
 * global value from the global sync settings; off, all of them are its own.
 */
export function GlobalSwitch({
  on,
  onChange,
  nudged,
}: {
  on: boolean
  onChange: (next: boolean) => void
  nudged: number
}) {
  const { t } = useT()
  return (
    <div key={nudged} data-new="use-global" data-nudged={nudged || undefined} className={nudged ? 'al-nudge' : undefined}>
      <ToggleRow label={t('edit.useGlobal')} hint={t('edit.useGlobalHint')} checked={on} onChange={onChange} />
    </div>
  )
}

/**
 * A control showing the global value while the switch holds it: greyed, out
 * of reach, with "global" beside it. Reaching for it nudges the switch, since
 * that is where it is let go. The mouse press does not take focus, or one
 * click would nudge twice.
 */
export function Held({
  held,
  onHeld,
  block = false,
  children,
}: {
  held: boolean
  onHeld: () => void
  /**
   * Spans its card, for a bar rather than a control at a row's end. In a
   * narrow card the mark goes under the bar, so the bar keeps its rows.
   */
  block?: boolean
  children: ReactNode
}) {
  const { t } = useT()
  if (!held) return <div className={block ? 'w-full' : 'flex min-w-0 max-w-full'}>{children}</div>
  return (
    <div
      role="group"
      tabIndex={0}
      aria-disabled="true"
      aria-label={t('edit.globalTip')}
      data-held=""
      onMouseDown={(e) => e.preventDefault()}
      onClick={onHeld}
      onFocus={onHeld}
      className={`flex min-w-0 max-w-full items-center justify-end gap-2 ${block ? 'w-full flex-wrap' : ''} outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring)`}
      style={{ borderRadius: 'var(--radius-control)' }}
    >
      <div inert className={`min-w-0 max-w-full opacity-50 grayscale ${block ? 'flex-[1_1_20rem]' : 'flex'}`}>
        {children}
      </div>
      <span className="shrink-0 text-subline text-carbon-textMuted" data-tip={t('edit.globalTip')}>
        {t('edit.global')}
      </span>
    </div>
  )
}

/** One setting on a line, its name at the start and its control at the end, which the switch may hold. */
export function SettingRow({
  label,
  hint,
  held = false,
  onHeld,
  children,
}: {
  label: string
  hint?: string
  /** Shows the control as the global value, out of reach. */
  held?: boolean
  onHeld?: () => void
  children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
      {/* Not a flex box, so a label that wraps keeps its (i) after its last word. */}
      <span data-glim-label={label} className="min-w-0 flex-[1_1_12.5rem] text-body text-carbon-text">
        {label}
        {hint && (
          <span className="ms-1.5 inline-flex align-middle">
            <InfoBubble tip={hint} />
          </span>
        )}
      </span>
      <Held held={held} onHeld={onHeld ?? (() => undefined)}>
        {children}
      </Held>
    </div>
  )
}
