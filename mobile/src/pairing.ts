// Where the phone stands in its group and how a refusal reads, by the web's
// lib/pairing.ts rules. That file reads the browser's ApiError, so the phone
// keeps its own copy over EngineError.
import { EngineError, type ConnectInfo, type RelayConfig, type RelayMode } from "./api";
import { clock } from "./clock";
import type { T, TranslationKey } from "./i18n";

/** How long a new member may take to show up before the card suggests why nobody has. */
export const ALONE_AFTER_S = 60;

/** "gone" is a group whose members were there once and are unreachable now. */
export type PairStage = "unpaired" | "new" | "searching" | "alone" | "gone" | "paired";

export function pairStage(g: ConnectInfo, createdHere: boolean): PairStage {
  if (!g.active) return "unpaired";
  if (g.members.length > 0) return "paired";
  if (g.memberSeen) return "gone";
  if (g.joinedAgo >= ALONE_AFTER_S) return "alone";
  return createdHere ? "new" : "searching";
}

const KIND: Record<string, TranslationKey> = {
  container: "instances.kind.container",
  server: "instances.kind.server",
  desktop: "instances.kind.desktop",
  phone: "instances.kind.phone",
  android: "instances.kind.phone",
};

/** The kind an instance announced, in the reader's words, or nothing for one it did not. */
export function kindName(t: T, deployment: string): string {
  const key = KIND[deployment];
  return key ? t(key) : "";
}

/** A refused phrase or pairing request in the reader's language. */
export function refusalText(t: T, e: unknown): string {
  if (e instanceof EngineError) {
    const v = e.values ?? {};
    switch (e.code) {
      case "word_count":
        return t("pairing.errWordCount", { count: v.count ?? "" });
      case "unknown_word":
        return t("pairing.errUnknownWord", { position: v.position ?? "", word: v.word ?? "" });
      case "checksum":
        return t("pairing.errChecksum");
      case "phraseExists":
        return t("pairing.errExists");
    }
    if (e.status === 403) return t("login.wrong");
    if (e.status === 429) return t("login.locked");
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * When something was last seen, from Unix seconds, as a date and time: Hermes'
 * Intl has no relative "5 minutes ago" (see clock.ts).
 */
export function seenAt(lang: string, unixSeconds: number): string {
  return clock(new Date(unixSeconds * 1000).toISOString(), lang);
}

/** The routes the relay card offers, as on the web: "instance" is an own relay that a paired ArrowLoop serves. */
export type RelayForm = RelayMode | "instance";

export const FORMS: RelayForm[] = ["project", "own", "instance", "off"];

/**
 * relayForm tells the two kinds of own relay apart by the web's rule: an
 * address at the path an instance serves its relay under means an ArrowLoop
 * is the relay. React Native's URL has no `pathname`, so the path is cut out
 * by hand.
 */
export function relayForm(relay: Pick<RelayConfig, "mode" | "relayUrl" | "serve">): RelayForm {
  if (relay.mode !== "own") return relay.mode;
  const path = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+([^?#]*)/i.exec(relay.relayUrl.trim())?.[1] ?? "";
  return relay.serve || path.replace(/\/+$/, "") === "/relay/connect" ? "instance" : "own";
}

/** The mode the engine stores for a route. */
export function modeOf(form: RelayForm): RelayMode {
  return form === "instance" ? "own" : form;
}
