// The rainbow works by inheritance: `[data-rainbow] .glim-hue` in tokens.css
// redefines `--accent` for its subtree. `createPortal` moves a panel to <body>,
// out of that subtree, so without this hook the panel falls back to the global
// accent while the control that opened it wears its card's hue.
import { useLayoutEffect, useState, type RefObject } from "react";
import { hueVars } from "../appearance";

// Read off hueVars() so the list cannot drift from the properties it writes. Any
// hex yields the same keys.
const HUE_VARS = Object.keys(hueVars(0));

/** What a portalled panel needs to stand in its trigger's palette position. */
export interface PortalHue {
  /** Inline custom properties to spread onto the portalled element. */
  style: Record<string, string> | undefined;
  /** `"glim-hue"` when there is a hue to apply, otherwise `""`. */
  className: string;
}

/**
 * Copy the trigger's rainbow position onto a portalled panel, read from the
 * trigger's computed style so call sites pass nothing.
 *
 * `.glim-hue` travels with the properties because the tokens.css rules on that
 * class derive `--accent`, which keeps every rainbow mode working. With rainbow
 * off there is nothing to copy and the panel keeps the global accent. The class
 * is never applied without the properties, since `.glim-hue` with no
 * `--item-hue` under it resolves the accent to nothing.
 */
export function usePortalHue(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>
): PortalHue {
  const [hue, setHue] = useState<Record<string, string> | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setHue(null);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    const cs = getComputedStyle(trigger);
    const vars: Record<string, string> = {};
    for (const name of HUE_VARS) {
      const value = cs.getPropertyValue(name).trim();
      if (value) vars[name] = value;
    }
    setHue(Object.keys(vars).length > 0 ? vars : null);
  }, [open, triggerRef]);

  return { style: hue ?? undefined, className: hue ? "glim-hue" : "" };
}
