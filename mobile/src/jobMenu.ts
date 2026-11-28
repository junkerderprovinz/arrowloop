import { jobActionGroups } from "../../web/src/lib/jobActions.data.ts";
import type { TranslationKey } from "./i18n";

/**
 * One row of a card's menu. There is no danger style: every delete asks
 * first, and the question is the warning.
 */
export interface CardAction {
  label: string;
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
}

/** A row, or "-" for the line between two groups. */
export type CardEntry = CardAction | "-";

export interface JobMenuActions {
  /** The card's alone, since the job's screen is where these lead. */
  open?: () => void;
  edit?: () => void;
  duplicate: () => void;
  preview: () => void;
  check: () => void;
  dupes: () => void;
  trash: (side: "left" | "right", place: string) => void;
  remove: () => void;
}

/**
 * A job's More menu, on its card or on its own screen, in the groups the
 * container's menus use. The card adds Open, which tapping it does too, so
 * it can be found. The job's screen is where it is edited, so it leaves out
 * Open and Edit. The trash has a row per side, since the phone's trash shows
 * one side at a time. Without `act` the job is not saved yet, and every row
 * stands disabled where it will be.
 */
export function jobMenu(
  t: (key: TranslationKey) => string,
  [upper, lower]: readonly [string, string],
  act: JobMenuActions | null,
  place: "card" | "screen",
): CardEntry[] {
  const row = (label: string, glyph: string, press?: () => void): CardAction => ({
    label,
    glyph,
    onPress: press ?? (() => {}),
    disabled: !press,
  });
  const rows = {
    edit: () => [
      ...(place === "card" ? [row(t("action.open"), "IconSync", act?.open)] : []),
      row(t("action.edit"), "IconPencil", act?.edit),
    ],
    duplicate: () => [row(t("edit.duplicate"), "IconCopy", act?.duplicate)],
    preview: () => [row(t("jobs.preview"), "IconPreview", act?.preview)],
    check: () => [row(t("jobs.check"), "IconCheck", act?.check)],
    dupes: () => [row(t("jobs.dupes"), "IconSearch", act?.dupes)],
    trash: () => [
      row(`${t("nav.trash")} · ${upper}`, "IconTrash", act ? () => act.trash("left", upper) : undefined),
      row(`${t("nav.trash")} · ${lower}`, "IconTrash", act ? () => act.trash("right", lower) : undefined),
    ],
    remove: () => [row(t("action.delete"), "IconTrash", act?.remove)],
  };
  return jobActionGroups(place === "screen").flatMap((group, i) => [
    ...(i > 0 ? (["-"] as const) : []),
    ...group.flatMap((action) => rows[action]()),
  ]);
}
