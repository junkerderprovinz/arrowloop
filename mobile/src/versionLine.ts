import { updateLine, type UpdateState, type VersionCardText } from "@glimstone/core/versionCards";

/**
 * updateLine for Hermes, which has no Intl.RelativeTimeFormat: there the time
 * of the last check stands as a clock time instead of "3 minutes ago".
 */
export function versionLine(state: UpdateState, text: VersionCardText, lang?: string): ReturnType<typeof updateLine> {
  if (state.kind === "current" && state.checkedAt && typeof Intl.RelativeTimeFormat !== "function") {
    const at = state.checkedAt.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
    return { ...updateLine({ kind: "current" }, text), note: at };
  }
  return updateLine(state, text);
}
