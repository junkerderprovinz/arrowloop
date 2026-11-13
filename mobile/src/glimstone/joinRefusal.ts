// joinRefusalText from GlimStone's fortress.ts, the one part of the fortress
// flow the phone needs, since its Pairing screen joins without that flow.

import type { FortressText } from "./fortressText.ts";

/** The sentence for a join the kit turned away, by its code: words that open no fortress, or a fortress that takes no new app until its phrase changes. An unknown code gets `failed`. */
export function joinRefusalText(text: FortressText, code: string): string {
  if (code === "phrase") return text.joinRefused;
  if (code === "closedUntilNewPhrase") return text.joinLocked;
  return text.failed;
}
