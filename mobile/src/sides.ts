import type { T } from "./i18n";

/**
 * Names a side after what it is: a plain path is on the device, `target:path`
 * is that target. "Local" and "cloud" would be wrong whenever both sides are
 * folders or both are remotes.
 */
export function sideName(side: string | undefined, t: T, expect: "device" | "target" = "device"): string {
  const remote = remoteOf(side);
  if (remote) return remote;
  // An empty field is named after what it is for, so two empty fields do not
  // carry the same label.
  if (!side) return expect === "target" ? t("side.target") : t("side.onDevice");
  return t("side.onDevice");
}

/**
 * Names both sides for a line that sets one against the other. Two sides that
 * would carry one name, such as two folders on the device, go by their last
 * folder, and by as many parent folders as it takes when those match too:
 * "Handy/Musik" and "Ablage/Musik".
 */
export function sidePair(left: string | undefined, right: string | undefined, t: T): [string, string] {
  const a = sideName(left, t);
  const b = sideName(right, t, "target");
  if (a !== b) return [a, b];
  const x = folders(left);
  const y = folders(right);
  for (let n = 1; n <= Math.max(x.length, y.length); n++) {
    const one = x.slice(-n).join("/");
    const two = y.slice(-n).join("/");
    if (one !== two) return [one || a, two || b];
  }
  return [a, b];
}

/**
 * Names the two sides of the job called `name`. A job the list does not hold
 * gets the names of two empty sides.
 */
export function jobSides(
  jobs: { name: string; left: string; right: string }[],
  name: string,
  t: T,
): [string, string] {
  const job = jobs.find((j) => j.name === name);
  return sidePair(job?.left, job?.right, t);
}

function folders(side: string | undefined): string[] {
  const remote = remoteOf(side);
  const path = (side ?? "").slice(remote ? remote.length + 1 : 0);
  return path.split(/[/\\]/).filter(Boolean);
}

/**
 * Returns the target's name in `name:path`, or undefined for a plain path. The
 * colon has to come before any slash, which is rclone's own rule.
 */
export function remoteOf(side: string | undefined): string | undefined {
  if (!side) return undefined;
  const colon = side.indexOf(":");
  if (colon <= 0) return undefined;
  const slash = side.search(/[/\\]/);
  if (slash !== -1 && slash < colon) return undefined;
  return side.slice(0, colon);
}
