import { bytes } from "../../web/src/lib/bytes.ts";
import type { Run } from "./api";
import type { T } from "./i18n";

/** What a run did, one phrase per figure it has, with its numbers written in the reader's way. */
export function runFigures(run: Run, t: T, lang: string): string[] {
  const parts: string[] = [];
  const add = (
    n: number,
    key: "history.copied" | "history.moved" | "history.trashed" | "history.deleted" | "history.left" | "history.conflicts",
  ) => {
    if (n > 0) parts.push(t(key, { count: n }));
  };
  add(run.Copied, "history.copied");
  add(run.Moved, "history.moved");
  add(run.Trashed, run.NoTrash ? "history.deleted" : "history.trashed");
  add(run.Skipped, "history.left");
  add(run.Conflicts, "history.conflicts");
  if (run.Bytes) parts.push(t("history.transferred", { size: bytes(run.Bytes, lang) }));
  return parts;
}
