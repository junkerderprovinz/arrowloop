import { useEffect, useState } from "react";
import { getLabelMode, subscribeLabelMode, type LabelAxis, type LabelMode } from "../controls.ts";

/**
 * The current label mode for one axis. The first value is read synchronously so
 * the first paint is already right.
 */
export function useLabelMode(axis: LabelAxis): LabelMode {
  const [mode, setMode] = useState<LabelMode>(() => getLabelMode(axis));
  useEffect(() => subscribeLabelMode(() => setMode(getLabelMode(axis))), [axis]);
  return mode;
}
