// The rainbow works by inheritance: `[data-rainbow] .glim-hue` in tokens.css
// redefines `--accent` for its subtree. A panel rendered into <body> leaves
// that subtree, so without this it falls back to the global accent while the
// control that opened it wears its card's hue.
import { hueVars } from "./appearance.ts";

// Read off hueVars() so the list cannot drift from the properties it writes.
// Any index yields the same keys.
const HUE_VARS = Object.keys(hueVars(0));

/**
 * The trigger's rainbow position as inline custom properties for a portalled
 * panel, read from its computed style so call sites pass nothing, or null when
 * the rainbow is off and the panel keeps the global accent.
 *
 * Put `.glim-hue` on the panel together with the properties, never alone: the
 * class derives `--accent` from `--item-hue`, and without it the accent
 * resolves to nothing.
 */
export function readPortalHue(trigger: Element): Record<string, string> | null {
  const cs = getComputedStyle(trigger);
  const vars: Record<string, string> = {};
  for (const name of HUE_VARS) {
    const value = cs.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  return Object.keys(vars).length > 0 ? vars : null;
}
