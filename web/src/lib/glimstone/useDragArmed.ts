import { useLayoutEffect, type RefObject } from "react";

/**
 * useDragArmed makes the other items of a reorderable list tremble while one
 * is held, by keeping `glim-drag-armed` on the list. Call it from the drag
 * gesture, so no list can forget the class.
 */
export function useDragArmed(list: RefObject<HTMLElement | null>, held: boolean): void {
  // After every render, since a list that rewrites its own className drops the class.
  useLayoutEffect(() => {
    list.current?.classList.toggle("glim-drag-armed", held);
  });
}
