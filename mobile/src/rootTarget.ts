import { remoteOf } from "../../web/src/lib/side.data.ts";
import type { Remote } from "./api";

/**
 * The description internal/appdata gives the Root target, which tells it
 * from a target somebody else named Root.
 */
export const ROOT_MARKER = "The whole file system of this phone, read only, set up by ArrowLoop";

type Sides = { left: string; right: string; direction?: string; mode?: string };

/**
 * The side of a job that a run would write to on the Root target, which only
 * reads, or null. It mirrors `written` in internal/job/job.go, which is what
 * actually refuses the job.
 */
export function rootWritten(job: Sides, remotes: Remote[]): "left" | "right" | null {
  const moves = job.mode === "move";
  const written: ("left" | "right")[] =
    job.direction === "leftToRight" && !moves
      ? ["right"]
      : job.direction === "rightToLeft" && !moves
        ? ["left"]
        : ["left", "right"];
  return written.find((side) => onRoot(job[side], remotes)) ?? null;
}

function onRoot(side: string, remotes: Remote[]): boolean {
  const target = remotes.find((r) => r.name === remoteOf(side));
  return target?.settings.some((s) => s.key === "description" && s.value === ROOT_MARKER) ?? false;
}
