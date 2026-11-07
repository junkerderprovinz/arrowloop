import { useLayoutEffect, useState, type RefObject } from "react";
import { readPortalHue } from "../portalHue.ts";

/** What a portalled panel needs to stand in its trigger's palette position. */
export interface PortalHue {
  /** Inline custom properties to spread onto the portalled element. */
  style: Record<string, string> | undefined;
  /** `"glim-hue"` when there is a hue to apply, otherwise `""`. */
  className: string;
}

/** Copies the trigger's rainbow position onto a portalled panel while it is open. */
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
    if (triggerRef.current) setHue(readPortalHue(triggerRef.current));
  }, [open, triggerRef]);

  return { style: hue ?? undefined, className: hue ? "glim-hue" : "" };
}
