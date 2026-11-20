/** The parts of the job form a refusal can point at. */
export type Spot = "name" | "left" | "right" | "schedule" | "quiet" | "modWindow" | "exclude";

/**
 * The part of the form an engine refusal is about, read from what it names.
 * Most name a place, so the target side is where the rest is said.
 */
export function spotOf(message: string): Spot {
  if (/schedule|watch/i.test(message)) return "schedule";
  if (/quietPeriod/i.test(message)) return "quiet";
  if (/modWindow/i.test(message)) return "modWindow";
  if (/exclude/i.test(message)) return "exclude";
  if (/no name/i.test(message)) return "name";
  if (/\bleft\b/i.test(message)) return "left";
  return "right";
}

/**
 * A duration as typed into a job's own field. An empty one would give the job
 * back to the global value and replace what is being typed with it, so a job
 * that wants none says 0s.
 */
export function durationWritten(typed: string): string {
  return typed.trim() || "0s";
}
