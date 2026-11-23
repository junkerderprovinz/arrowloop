import { isLocalTarget } from "../../web/src/lib/localTarget.ts";
import type { Remote } from "./api";

/** A card on the Targets screen, and whether it asks the target how it is. */
export interface TargetRow {
  remote: Remote;
  elsewhere: boolean;
}

/**
 * Every target gets a card, a folder on this phone too, so it can be edited
 * and renamed where it was made. Only storage elsewhere says whether it
 * answers and how full it is: for a folder here that would be the phone's
 * own space.
 */
export function targetRows(remotes: Remote[]): TargetRow[] {
  return remotes.map((remote) => ({ remote, elsewhere: !isLocalTarget(remote) }));
}
