import { entryWay } from "../../web/src/lib/entryLabel.ts";
import { sidePair } from "./sides.ts";
import type { T } from "./i18n";

type JobSides = { id?: string; name: string; left: string; right: string };
type Line = { Job: string; JobID?: string; Kind: string; Side?: string; Note?: string };

/**
 * The job a line of the file log belongs to: by id first, since the name a
 * line carries is the one the job had when it ran.
 */
export function lineJob<J extends JobSides>(line: Line, jobs: J[]): J | undefined {
  return jobs.find((j) => line.JobID && j.id === line.JobID) ?? jobs.find((j) => j.name === line.Job);
}

/**
 * Which way a line of the file log took its file, in the names the job's card
 * gives its sides: from one to the other, or the one side a deletion or a
 * rename happened on. Null for a job that is gone and for a line that has no
 * way, such as a skip.
 */
export function fileWay(line: Line, jobs: JobSides[], t: T): { from: string; to: string } | { on: string } | null {
  const job = lineJob(line, jobs);
  if (!job) return null;
  const way = entryWay({ Kind: line.Kind, Side: line.Side ?? "", Note: line.Note });
  if (!way) return null;
  const [left, right] = sidePair(job.left, job.right, t);
  const name = (side: "left" | "right") => (side === "left" ? left : right);
  return "on" in way ? { on: name(way.on) } : { from: name(way.from), to: name(way.to) };
}
