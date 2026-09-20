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
