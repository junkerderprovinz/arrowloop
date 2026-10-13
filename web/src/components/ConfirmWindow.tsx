import { useRef } from 'react'
import { createPortal } from 'react-dom'

import { ConfirmDialog, type ConfirmDialogProps } from '../lib/glimstone/ConfirmDialog'
import { useModal } from '../lib/modal'

/**
 * GlimStone's confirmation with the part its file leaves to the app: drawn in
 * the body, so a card that slides in cannot clip it, with Escape, a focus trap
 * and the focus handed back on close. Escape answers Cancel and closes only
 * the confirmation, not a window it was asked from.
 */
export function ConfirmWindow(props: Omit<ConfirmDialogProps, 'ref'>) {
  const card = useRef<HTMLDivElement>(null)
  // Cancel has autofocus, which is where the focus has to start.
  useModal(card, props.onCancel, { focus: 'keep' })
  return createPortal(<ConfirmDialog {...props} ref={card} />, document.body)
}
