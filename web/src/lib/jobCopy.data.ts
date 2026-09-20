/**
 * Making a copy of a job, shared by the container and the phone. Plain
 * TypeScript without React or `import.meta`, so Metro can read it.
 *
 * The copy arrives held. It points at the same two folders as its original with
 * a state database of its own, so run on the same schedule the two would
 * compare the same files against different records and undo each other's work.
 */

/** The little of a job this needs to know. Structural, because the two
 *  surfaces spell their job type differently. */
export interface CopyableJob {
  name?: string;
  state?: string;
  disabled?: boolean;
}

/**
 * The copy of `source` that belongs beside it.
 *
 * `taken` is every name already in use. `suffix` is the translated word for a
 * copy and `fallback` the translated name for a job with none, passed in
 * because this file cannot reach a translator.
 */
export function jobCopy<T extends CopyableJob>(
  source: T,
  taken: readonly string[],
  suffix: string,
  fallback: string,
): T {
  const name = uniqueName(`${source.name || fallback}-${suffix}`, taken);
  return {
    ...source,
    name,
    // Its own database; two jobs writing one record would delete each other's files.
    state: `state/${name}.db`,
    disabled: true,
  };
}

/**
 * A name nothing else has, counting up from the one that was wanted. Starts at
 * 2, so a lone copy is "x-copy" rather than "x-copy-1".
 */
export function uniqueName(base: string, taken: readonly string[]): string {
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base}-${n}`;
  return name;
}
