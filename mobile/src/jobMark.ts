import type { TranslationKey } from "../../web/src/lib/i18n.data";
import type { Remote } from "./api";

/**
 * Which logo belongs on a job's card, from the target its side names.
 *
 * jdp: "Auf der card soll auch das logo des verbundenen cloudspeichers sein."
 *
 * A side is either a path on the phone or `target:folder`, so the name before
 * the colon is the target, and the TARGET already knows its own logo: the
 * engine resolves the product from the settings it was created with and hands
 * back `mark`. See internal/remotes/identify.go.
 *
 * This used to work it out here, from the rclone backend alone, and had to
 * refuse whenever more than one product shared one - which was every object
 * store and every WebDAV cloud, so the two groups most likely to be somebody's
 * target were exactly the two that never got a logo. The rule it refused under
 * is still the right rule (a mark naming the WRONG service is worse than no
 * mark); what changed is that nothing has to be guessed any more.
 */
export function markForSide(side: string, remotes: Remote[]): string | undefined {
  const colon = side.indexOf(":");
  // A Windows drive letter is not a target. Nothing on a phone writes one, and
  // a one-character name before the colon is the cheap way to say so.
  if (colon < 2) return undefined;
  const remote = remotes.find((r) => r.name === side.slice(0, colon));
  return remote?.mark || undefined;
}

/**
 * The direction, as the words a person would say.
 *
 * The card carried an arrow alone, which is faster to read once somebody knows
 * what the three arrows mean and says nothing at all before then. jdp: "auf der
 * auftrag card soll auch die synchronisationsrichtung zu sehen sein." Both now:
 * the arrow keeps the position it had between the two paths, and the words sit
 * beside it.
 *
 * The engine's own spellings, and the older ones beside them - a configuration
 * written by an earlier build carries `toRight`, and a card that fell through
 * to "both ways" for it would describe a one-way job as two-way.
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
