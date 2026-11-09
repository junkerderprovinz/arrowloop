import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { hueVars } from '../lib/appearance'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { IconClose } from '../lib/glimstone/glyphs'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { useT } from '../lib/i18n'
import { useModal } from '../lib/modal'
import { storageKey } from '../lib/storage'

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

type Size = { w: number; h: number }

/** The smallest a window can be dragged to, so its heading and buttons keep their room. */
const MIN: Size = { w: 360, h: 240 }

function storedSize(key: string | undefined): Size | null {
  if (!key) return null
  try {
    const got = JSON.parse(localStorage.getItem(storageKey(`dialog-${key}`)) ?? 'null') as Size | null
    return got && got.w > 0 && got.h > 0 ? got : null
  } catch {
    return null
  }
}

/** A phone-narrow window is a sheet on the bottom edge (index.css), which keeps the screen's width. */
function sheet(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 639px)').matches
}

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
  sizeKey,
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
  /**
   * Lets the window be dragged larger by its corner, and keeps the size for
   * the next window that passes the same key.
   */
  sizeKey?: string
  children: ReactNode
}) {
  const { t } = useT()
  const card = useRef<HTMLDivElement>(null)
  useModal(card, onClose)
  // A press that starts inside the card and ends on the backdrop, as when
  // selecting text, is not a click on the backdrop.
  const pressedBackdrop = useRef(false)
  const [size, setSize] = useState<Size | null>(() => storedSize(sizeKey))
  const drag = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const resizable = !!sizeKey && !sheet()
  const sized = resizable && size

  // The window stands in the middle, so the corner follows the pointer when
  // the window grows by twice the distance moved.
  const sizeAt = (e: PointerEvent): Size => {
    const from = drag.current!
    const way = document.dir === 'rtl' ? -1 : 1
    return {
      w: Math.round(Math.min(Math.max(from.w + 2 * way * (e.clientX - from.x), MIN.w), window.innerWidth - 32)),
      h: Math.round(Math.min(Math.max(from.h + 2 * (e.clientY - from.y), MIN.h), window.innerHeight - 32)),
    }
  }

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
        className={`glim-modal-card relative flex w-full flex-col rounded-card bg-carbon-surface shadow-2xl outline-none ${
          sized ? 'max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)]' : `max-h-[85vh] ${WIDTH[width]}`
        }${hueIndex !== undefined ? ' glim-hue' : ''}`}
        style={{
          ...(hueIndex !== undefined ? (hueVars(hueIndex) as CSSProperties) : {}),
          ...(sized ? { width: `${size.w}px`, height: `${size.h}px` } : {}),
        }}
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
        {resizable && (
          <span
            data-testid="dialog-grip"
            aria-hidden
            className="absolute bottom-1 end-1 flex h-4 w-4 touch-none items-end justify-end text-carbon-textMuted hover:text-carbon-text ltr:cursor-nwse-resize rtl:cursor-nesw-resize"
            onPointerDown={(e) => {
              const box = card.current!.getBoundingClientRect()
              drag.current = { x: e.clientX, y: e.clientY, w: box.width, h: box.height }
              e.currentTarget.setPointerCapture?.(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (drag.current) setSize(sizeAt(e))
            }}
            onPointerUp={(e) => {
              if (!drag.current) return
              const next = sizeAt(e)
              drag.current = null
              setSize(next)
              try {
                localStorage.setItem(storageKey(`dialog-${sizeKey}`), JSON.stringify(next))
              } catch {
                // Private windows may refuse storage; the size then lasts until the window closes.
              }
            }}
          >
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M9 3 3 9M9 7 7 9" />
            </svg>
          </span>
        )}
      </div>
    </div>,
    document.body,
  )
}
