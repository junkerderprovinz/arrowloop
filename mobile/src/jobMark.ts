import type { TranslationKey } from "../../web/src/lib/i18n.data";
import type { Provider, Remote } from "./api";

/**
 * Which logo belongs on a job's card, from the target its side names.
 *
 * jdp: "Auf der card soll auch das logo des verbundenen cloudspeichers sein."
 *
 * A side is either a path on the phone or `target:folder`, so the name before
 * the colon is the target, the target says which rclone BACKEND it is, and a
 * provider with that backend says which mark to draw.
 *
 * THE LAST STEP IS WHERE THIS HAS TO BE CAREFUL. Several products share one
 * backend - Nextcloud, ownCloud, OpenCloud and Seafile are all `webdav` - and a
 * target does not record which of them created it. Picking the first match
 * would put Nextcloud's logo on somebody's ownCloud, and this house's standing
 * rule is that a mark naming the WRONG service is worse than no mark at all.
 *
 * So a backend claimed by more than one marked provider gets NONE. Twenty-odd
 * targets are unambiguous - Dropbox, MEGA, Backblaze, pCloud - and those are
 * the ones this answers for.
 */
export function markForSide(
  side: string,
  remotes: Remote[],
  providers: Provider[],
): string | undefined {
  const colon = side.indexOf(":");
  // A Windows drive letter is not a target. Nothing on a phone writes one, and
  // a one-character name before the colon is the cheap way to say so.
  if (colon < 2) return undefined;
  const name = side.slice(0, colon);
  const remote = remotes.find((r) => r.name === name);
  if (!remote) return undefined;

  const marked = providers.filter((p) => p.backend === remote.type && p.mark);
  if (marked.length !== 1) return undefined;
  return marked[0]?.mark;
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
