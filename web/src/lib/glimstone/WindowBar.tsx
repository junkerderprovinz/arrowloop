import { useRef, type MouseEvent, type ReactNode } from "react";
import { IconClose, IconWindowMaximise, IconWindowMinimise, IconWindowRestore } from "./glyphs";
import { IconTipButton } from "./IconTipButton";

// The title bar a desktop app draws where its window has no native one
// (design-language.md, "The desktop window frame"): a strip to drag and the
// three window buttons, nothing else. The rail already shows the mark and the
// name. It knows nothing of the shell that hosts the page; the app hands it
// the window calls and whether the window is maximised.
//
// Render it only where the app draws its own frame. tokens.css moves the page
// and every scrim below it as soon as it is in the document.

export interface WindowBarProps {
  /** The app's name. The bar shows none, so this is what a screen reader
   *  announces for it. */
  appName: string;
  /** Whether the window fills the screen. The middle button then restores it,
   *  and the app turns its edge resizing off. */
  maximised: boolean;
  /** The buttons' accessible names, which also show in their bubbles. */
  text: { minimise: string; maximise: string; restore: string; close: string };
  onMinimise: () => void;
  onToggleMaximise: () => void;
  /** Asks the way the native close button does, so an app that hides to the
   *  tray on close still does. */
  onClose: () => void;
  /** Called once a press on the bar starts to move. The app hands the press to
   *  the system, which moves the window from there. */
  onDragStart: () => void;
}

const onButton = (e: MouseEvent) => (e.target as Element).closest("button") !== null;

export function WindowBar({
  appName,
  maximised,
  text,
  onMinimise,
  onToggleMaximise,
  onClose,
  onDragStart,
}: WindowBarProps) {
  // The drag starts on the first move, not on the press, so a click and a
  // double click on the bar stay clicks. An edge the app's resize has taken
  // arrives with its default prevented and is left to it.
  const pressed = useRef(false);
  const down = (e: MouseEvent) => {
    pressed.current = e.button === 0 && !e.defaultPrevented && !onButton(e);
  };
  const move = (e: MouseEvent) => {
    if (!pressed.current) return;
    pressed.current = false;
    if (e.buttons === 1) onDragStart();
  };
  const toggle = (e: MouseEvent) => {
    if (!onButton(e)) onToggleMaximise();
  };

  return (
    <header
      aria-label={appName}
      className="glim-window-bar"
      onMouseDown={down}
      onMouseMove={move}
      onMouseUp={() => (pressed.current = false)}
      onDoubleClick={toggle}
    >
      <WindowButton label={text.minimise} onPress={onMinimise}>
        <IconWindowMinimise />
      </WindowButton>
      <WindowButton label={maximised ? text.restore : text.maximise} onPress={onToggleMaximise}>
        {maximised ? <IconWindowRestore /> : <IconWindowMaximise />}
      </WindowButton>
      <WindowButton label={text.close} onPress={onClose}>
        <IconClose />
      </WindowButton>
    </header>
  );
}

// The button takes the bar's full height and shows the house square inside, so
// a pointer thrown into the corner of a maximised window still lands on close.
function WindowButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <IconTipButton tip={label} onClick={onPress} className="glim-window-button">
      <span className="glim-window-square">{children}</span>
    </IconTipButton>
  );
}
