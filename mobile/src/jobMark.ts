import type { TranslationKey } from "../../web/src/lib/i18n.data";
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

/**
 * Returns the translation key that names a job's direction. Older
 * configurations spell it `toRight` or `right`, and those have to read as one
 * way too.
 */
export function directionKey(direction: string | undefined): TranslationKey {
  if (direction === "leftToRight" || direction === "toRight" || direction === "right") {
    return "direction.toRight";
  }
  if (direction === "rightToLeft" || direction === "toLeft" || direction === "left") {
    return "direction.toLeft";
  }
  return "direction.both";
}
