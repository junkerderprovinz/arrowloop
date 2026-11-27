import { AT_START, atStartOf, type AtStartChoice, type RunAtStart } from "../../web/src/lib/atStart.ts";

/**
 * The choices the phone offers. Its engine starts with the app and again after
 * every eviction, so a job that ran at every start would run several times a
 * day; one carrying that from another machine still shows it, so it can be
 * switched off.
 */
export function phoneAtStart(value: RunAtStart | undefined): AtStartChoice[] {
  return atStartOf(value) === "always" ? AT_START : AT_START.filter((c) => c !== "always");
}
