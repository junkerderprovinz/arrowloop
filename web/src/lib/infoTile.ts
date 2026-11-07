// The logic behind the Info tile ("The Info tile and the About card" in
// design-language.md): which version is a release with a page to open, what the
// update check shows on itself, and whether the Help card offers mail.

import type { ButtonTone } from "./button.ts";
import { groupStage, type WidthStage } from "./controls.ts";

export type OpenUrl = (url: string) => void;

export const openInBrowser: OpenUrl = (url) => {
  window.open(url, "_blank", "noopener,noreferrer");
};

export interface VersionRow {
  /** The component's name at the row's start. It is not a link. */
  name: string;
  /** What the component is, as a sub-line under the name. */
  sub?: string;
  /** Read from the build or from the copied files that own it, never typed in. */
  version: string;
  /** The repository whose release page the number opens. Without one the
   *  number is plain text. */
  repoUrl?: string;
  /** Stands in front of the tag where one repository ships several artefacts,
   *  such as `mobile/`. */
  tagPrefix?: string;
}

export interface UpdateCheck {
  /**
   * Checks every listed component at once and resolves to how many have a
   * newer release. It rejects when the check cannot run; the app puts the
   * reason in a toast, and the button shakes.
   */
  run: () => Promise<number>;
  text: {
    check: string;
    upToDate: string;
    updatesFound: (count: number) => string;
    checkFailed: string;
  };
}

/**
 * The tag behind a running version string: for `v8.3.1+feature-branch.59b73a6`
 * it is the part before the semver build metadata.
 */
export function releaseTag(version: string): string {
  const bare = (version.split("+")[0] ?? "").trim();
  if (!bare) return "";
  return bare.startsWith("v") ? bare : `v${bare}`;
}

/** A version as the card shows it: `v3.8.0` reads "3.8.0". The "v" names the tag, not the version. */
export function shownVersion(version: string): string {
  const trimmed = version.trim();
  return /^v\d/.test(trimmed) ? trimmed.slice(1) : trimmed;
}

/**
 * The number at a row's end and what it opens: a published release links its
 * page, a build that is not a release says so, and a row without a repository
 * shows the bare number.
 */
export function versionLink(row: VersionRow): { shown: string; released: boolean; href?: string } {
  const tag = releaseTag(row.version);
  const released = /^v\d+\.\d+\.\d+$/.test(tag);
  const shown = shownVersion(row.version);
  if (!released || !row.repoUrl) return { shown, released };
  return { shown, released, href: `${row.repoUrl}/releases/tag/${encodeURIComponent(`${row.tagPrefix ?? ""}${tag}`)}` };
}

/** The Help card offers mail only where its sentence names that route and there is an address. */
export function offersMail(report: string, mailAddress?: string): boolean {
  return /e-?mail/i.test(report) && Boolean(mailAddress);
}

/** Subject only: a prefilled body reads as a form to fill in. */
export function mailHref(address: string, subject: string): string {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}`;
}

export type UpdateVerdict = { kind: "idle" | "busy" | "current" | "failed" } | { kind: "found"; count: number };

/** What the update check shows on itself, like a test button. */
export function updateFace(
  verdict: UpdateVerdict,
  text: UpdateCheck["text"],
): { label: string; labelKey: string; tone: ButtonTone; announced: string } {
  const face: { label: string; labelKey: string; tone: ButtonTone } =
    verdict.kind === "current"
      ? { label: text.upToDate, labelKey: "about.upToDate", tone: "ok" }
      : verdict.kind === "found"
        ? { label: text.updatesFound(verdict.count), labelKey: "about.updatesFound", tone: "warn" }
        : verdict.kind === "failed"
          ? { label: text.checkFailed, labelKey: "about.checkFailed", tone: "danger" }
          : { label: text.check, labelKey: "about.checkUpdates", tone: "neutral" };
  const announced = verdict.kind === "idle" || verdict.kind === "busy" ? "" : face.label;
  return { ...face, announced };
}

/** One width for every verdict, so the button does not jump when its word changes. */
export function updateStage(text: UpdateCheck["text"], label: string): WidthStage {
  return groupStage([text.check, text.upToDate, text.updatesFound(2), text.checkFailed, label]);
}

/** Runs the check and reports each verdict as it comes; a check already running is left alone. */
export async function runUpdateCheck(
  check: UpdateCheck,
  current: UpdateVerdict,
  set: (v: UpdateVerdict) => void,
): Promise<void> {
  if (current.kind === "busy") return;
  set({ kind: "busy" });
  try {
    const count = await check.run();
    set(count > 0 ? { kind: "found", count } : { kind: "current" });
  } catch {
    set({ kind: "failed" });
  }
}
