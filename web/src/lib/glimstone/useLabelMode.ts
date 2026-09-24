import { useEffect, useState } from "react";
import { getLabelMode, type LabelAxis, type LabelMode } from "../controls";

const LABEL_MODE_CHANGED = "bv:label-mode-changed";

/** Announce that a label mode changed, so every mounted control re-reads it. */
export function labelModeChanged(): void {
  window.dispatchEvent(new Event(LABEL_MODE_CHANGED));
}

/**
 * The current label mode for one axis. The mode is set in one place and
 * read by every button, nav row and tab strip at once, so a window event keeps
 * them in step without a reload. The first value is read synchronously so the
 * first paint is already right.
 */
export function useLabelMode(axis: LabelAxis): LabelMode {
  const [mode, setMode] = useState<LabelMode>(() => getLabelMode(axis));
  useEffect(() => {
    const reread = () => setMode(getLabelMode(axis));
    window.addEventListener(LABEL_MODE_CHANGED, reread);
    // "storage" fires when another tab changes it; two tabs of one app with
    // different chrome would read as a bug.
    window.addEventListener("storage", reread);
    return () => {
      window.removeEventListener(LABEL_MODE_CHANGED, reread);
      window.removeEventListener("storage", reread);
    };
  }, [axis]);
  return mode;
}
