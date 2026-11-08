/**
 * Reading a job's side, shared with the phone. Plain TypeScript without React
 * or `import.meta`, so Metro can read it.
 */

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

/**
 * What a folder typed on the phone side of a job becomes. rclone takes any
 * `name:` in front for a target, so `C:/Program` would turn into a target
 * called C. On the phone only the names of the targets count; any other is
 * returned as `stray`, so the form can say why it was not taken.
 */
export function phoneFolder(typed: string, targets: readonly string[]): { side: string } | { stray: string } {
  const remote = remoteOf(typed);
  if (remote === undefined || targets.includes(remote)) return { side: typed };
  return { stray: remote };
}
