import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { hueVars } from '../lib/appearance'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { IconClose } from '../lib/glimstone/glyphs'
import { useT } from '../lib/i18n'

/**
 * A window over the dimmed page, built like GlimStone's confirmation dialog:
 * a heading badge on the card's edge, a close button, and a body that scrolls
 * when the window is taller than the screen.
 *
 * Rendered into the body, so a transformed ancestor cannot become its
 * containing block. Focus moves into the card on open and back to the control
 * that opened it on close.
 */
export function Dialog({
  title,
  hueIndex,
  onClose,
  closeOnBackdrop = true,
  children,
}: {
  title: string
  /** The rainbow position of the card that opened it, so the window keeps its hue. */
  hueIndex?: number
  onClose: () => void
  /**
   * Off while the window holds typed input, which one stray click beside the
   * card would otherwise throw away. Escape and the close button still work.
   */
  closeOnBackdrop?: boolean
  children: ReactNode
}) {
  const { t } = useT()
  const card = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  // A press that starts inside the card and ends on the backdrop, as when
  // selecting text, is not a click on the backdrop.
  const pressedBackdrop = useRef(false)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    card.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      // An open dropdown inside the window takes the Escape for itself.
      if (e.key === 'Escape' && !document.querySelector('[role="listbox"]')) close.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus()
    }
  }, [])

  return createPortal(
    <div
      className="glim-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (closeOnBackdrop && pressedBackdrop.current && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`glim-modal-card relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-card bg-carbon-surface shadow-2xl outline-none${
          hueIndex !== undefined ? ' glim-hue' : ''
        }`}
        style={hueIndex !== undefined ? (hueVars(hueIndex) as CSSProperties) : undefined}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4">
          <h2 className="flex items-center">
            <Badge tone="heading" size="heading" wrap hueIndex={hueIndex}>
              {title}
            </Badge>
          </h2>
          <Button
            label={t('common.close')}
            labelKey="common.close"
            glyph={<IconClose />}
            tone="neutral"
            onClick={onClose}
            className="shrink-0"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
