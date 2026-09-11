import type { T } from "./i18n";

/**
 * What to call a side, given what it actually is.
 *
 * The engine calls them left and right, and it is right to: the two are
 * symmetric, either can be a folder or a target, and a job in a container
 * routinely has neither of them on the machine it runs on. On a PHONE those
 * words mean nothing - there are no two columns to be left and right of.
 *
 * jdp: "in autosync heißt es auch lokaler und cloud ordner anstatt linke und
 * rechte seite. sollen wir das nicht übernehmen? macht es das nicht besser
 * verständlich in der app?" Yes, and not by copying those two words. A tool
 * that only ever syncs a phone against a cloud can hard-code "local" and
 * "cloud"; this one cannot, because both sides of a job can be folders on one
 * machine, or two remote services with no phone in the picture at all, and
 * then both labels would be false.
 *
 * So the side is named after what it IS. A plain path is on the device; a
 * `target:path` is that target, by the name its owner gave it. Both are true
 * in every case, and on a phone they read exactly as plainly as the words this
 * takes the idea from.
 */
export function sideName(side: string | undefined, t: T, expect: "device" | "target" = "device"): string {
  const remote = remoteOf(side);
  if (remote) return remote;
  // Nothing typed yet, so there is nothing to name it after. `expect` is what
  // the field is FOR rather than what it holds: two empty fields both saying
  // "on the device" is two identical labels above two different questions.
  if (!side) return expect === "target" ? t("side.target") : t("side.onDevice");
  return t("side.onDevice");
}

/**
 * The target's name in `name:path`, or nothing for a plain path.
 *
 * The colon has to come before any slash, which is what keeps a Windows path
 * and a folder with a colon in its name from being read as a target. rclone's
 * own rule, applied here so the label agrees with what the engine will do with
 * the same string.
 */
export function remoteOf(side: string | undefined): string | undefined {
  if (!side) return undefined;
  const colon = side.indexOf(":");
  if (colon <= 0) return undefined;
  const slash = side.search(/[/\\]/);
  if (slash !== -1 && slash < colon) return undefined;
  return side.slice(0, colon);
}
