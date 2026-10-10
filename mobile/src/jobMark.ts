import type { Remote } from "./api";

/**
 * Returns the logo of the target a side names. The engine resolves each
 * target's product and reports it as `mark` (internal/remotes/identify.go).
 */
export function markForSide(side: string, remotes: Remote[]): string | undefined {
  const colon = side.indexOf(":");
  // A one-character name before the colon is a drive letter, not a target.
  if (colon < 2) return undefined;
  const remote = remotes.find((r) => r.name === side.slice(0, colon));
  return remote?.mark || undefined;
}
