import { useRef, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { hueVars } from '../lib/appearance'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { IconClose } from '../lib/glimstone/glyphs'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { useT } from '../lib/i18n'
import { useModal } from '../lib/modal'

/**
 * A window over the dimmed page, built like GlimStone's confirmation dialog:
 * a heading badge on the card's edge, a body that scrolls when the window is
 * taller than the screen, and the way out in a button row at the bottom. On a
 * phone-narrow window it stands on the bottom edge as a sheet (index.css), so
 * that row stays under the thumb.
 *
 * Rendered into the body, so a transformed ancestor cannot become its
 * containing block. The keyboard stays inside while it is open (useModal).
 */
const WIDTH = { normal: 'max-w-xl', wide: 'max-w-3xl', widest: 'max-w-5xl' } as const

export function Dialog({
  title,
  hint,
  hueIndex,
  onClose,
  closeOnBackdrop = true,
  footer,
  search,
  bar,
  width = 'normal',
  children,
}: {
  title: string
  /** What the window is for, as the (i) in its heading. */
  hint?: string
  /** The rainbow position of the card that opened it, so the window keeps its hue. */
  hueIndex?: number
  onClose: () => void
  /**
   * Off while the window holds typed input, which one stray click beside the
   * card would otherwise throw away. Escape and the buttons still work.
   */
  closeOnBackdrop?: boolean
  /**
   * The bottom row's buttons, the way back first and the main one last. Left
   * out, the row holds a single Close.
   */
  footer?: ReactNode
  /**
   * A picker's search, at the end of the heading's line, where it stays put
   * while the body scrolls. The line wraps, so a narrow window puts it below.
   */
  search?: ReactNode
  /** A selector between the window's views, under the heading, where it stays put while the body scrolls. */
  bar?: ReactNode
  /**
   * `wide` has room for a list or a form with two columns; `widest` for two
   * cards side by side with a folder path in each, as a job's window.
   */
  width?: 'normal' | 'wide' | 'widest'
  children: ReactNode
}) {
  const { t } = useT()
  const card = useRef<HTMLDivElement>(null)
  useModal(card, onClose)
  // A press that starts inside the card and ends on the backdrop, as when
  // selecting text, is not a click on the backdrop.
  const pressedBackdrop = useRef(false)

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
        className={`glim-modal-card relative flex max-h-[85vh] w-full ${WIDTH[width]} flex-col rounded-card bg-carbon-surface shadow-2xl outline-none${
          hueIndex !== undefined ? ' glim-hue' : ''
        }`}
        style={hueIndex !== undefined ? (hueVars(hueIndex) as CSSProperties) : undefined}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-2 pt-5">
          <h2 className="flex items-center">
            <Badge tone="heading" size="heading" wrap hueIndex={hueIndex}>
              {title}
              {hint && <InfoBubble tip={hint} onAccent />}
            </Badge>
          </h2>
          {search}
        </div>
        {bar && <div className="px-5 pb-2 pt-1">{bar}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">{children}</div>
        <div className="glim-modal-foot flex flex-wrap items-center justify-end gap-2 px-5 py-4">
          {footer ?? (
            <Button label={t('common.close')} labelKey="common.close" glyph={<IconClose />} onClick={onClose} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
