// The styled confirmation dialog that replaces window.confirm(): an anchored
// header, a scrolling message and a footer with Cancel and Confirm. A backdrop
// click, the header close button and Cancel all call onCancel.
//
// The component holds no state and never touches `document`, so a test can call
// it with props and no DOM. The companion hook useConfirm owns the queue, the
// promise, the portal, Escape, the focus trap and returning focus on close,
// because Escape and the trap must work after focus has left this subtree.
// `ref` (a plain prop in React 19) is the card the hook traps focus in.
import type { ReactNode, Ref } from "react";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { IconCancel, IconClose } from "./glyphs";

export interface ConfirmDialogProps {
  /** A generic title such as "Confirm"; the call site's own text is `message`. */
  title: string;
  /** The question or explanation, also the dialog's accessible description. */
  message: string;
  confirmLabel: string;
  /** Translation key behind `confirmLabel`, so the confirm button can pick
   *  a glyph. Optional: a caller passing a composed or data label has none. */
  confirmLabelKey?: string;
  cancelLabel: string;
  /** A control the confirming action needs an answer to, such as "also remove
   *  X?", shown under the message so the question is asked in one window.
   *  Keep it to a switch or two. */
  extra?: ReactNode;
  /** Glyph for the confirm button. The action changes per call site, so no
   *  fixed key can name it; without one the button beside a glyphed Cancel
   *  looks unfinished. */
  confirmGlyph?: ReactNode;
  /** Accessible name for the header close button, separate from cancelLabel so
   *  the two controls are not announced alike. Leave it out and the button is
   *  not drawn, since a corner close beside Cancel reads as a second choice. */
  closeLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** The dialog card's root DOM node, for useConfirm.tsx's focus trap. */
  ref?: Ref<HTMLDivElement>;
}
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmLabelKey,
  confirmGlyph,
  extra,
  cancelLabel,
  closeLabel,
  onConfirm,
  onCancel,
  ref,
}: ConfirmDialogProps) {
  return (
    <div
      className="glim-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmdialog-title"
        aria-describedby="confirmdialog-message"
        className="glim-modal-card relative flex max-h-[85vh] w-full max-w-md flex-col rounded-card bg-carbon-surface shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4">
          {/* Rule 15: the title is a heading badge. It straddles the card's top
              edge against the `relative` outer box, which does not scroll and
              so does not clip it. */}
          <h2 id="confirmdialog-title" className="flex items-center">
            <Badge tone="heading" size="heading" wrap>{title}</Badge>
          </h2>
          {/* A Button, so the close control follows the label mode. */}
          {closeLabel !== undefined && (
            <Button
              label={closeLabel}
              labelKey="common.close"
              glyph={<IconClose />}
              tone="neutral"
              onClick={onCancel}
              className="shrink-0"
            />
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p id="confirmdialog-message" className="text-sm leading-relaxed text-carbon-textSub wrap-break-word">
            {message}
          </p>
          {extra !== undefined && <div className="mt-4 flex flex-col gap-3">{extra}</div>}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4">
          <Button
            label={cancelLabel}
            labelKey="common.cancel"
            glyph={<IconCancel />}
            tone="neutral"
            autoFocus
            onClick={onCancel}
          />
          <Button
            label={confirmLabel}
            // `null` means no key: the action being confirmed has no fixed one.
            labelKey={confirmLabelKey ?? null}
            glyph={confirmGlyph}
            // Not red ("Destructive and confirmable actions"): the dialog's
            // sentence is the warning, and neither button is recommended.
            tone="neutral"
            onClick={onConfirm}
          />
        </div>
      </div>
    </div>
  );
}
