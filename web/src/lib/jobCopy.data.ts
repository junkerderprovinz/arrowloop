/**
 * Making a copy of a job, once, for both interfaces.
 *
 * jdp: "auftraege soll man via hamburgermenue auch duplizieren koennen." The
 * container has had this for a while and the reasoning behind it is worth more
 * than the four lines of code, so the phone gets the SAME function rather than a
 * second one that agrees with it today.
 *
 * `.data.ts` for the same reason `schedule.data.ts` and `i18n.data.ts` carry
 * that suffix: Metro reads these files directly, so anything here must be plain
 * TypeScript with no React and no `import.meta`. A rule that lives in a hook is
 * a rule only one of the two surfaces can reach.
 *
 * THE COPY ARRIVES HELD, and that is the part worth keeping. It points at the
 * same two folders as its original with a state database of its own, so let go
 * on the same schedule the pair would compare the same files against two
 * different records and undo each other's work. It is released by the same
 * switch every other job uses, once somebody has pointed it somewhere else.
 */

/** The little of a job this needs to know. Deliberately structural: the two
 *  surfaces spell their job type differently and neither should have to import
 *  the other's. */
export interface CopyableJob {
  name?: string;
  state?: string;
  disabled?: boolean;
}

/**
 * The copy of `source` that belongs beside it.
 *
 * `taken` is every name already in use, so the suffix can be counted up rather
 * than colliding. `suffix` is the translated word for a copy and `fallback` the
 * translated name for a job with none, both passed in because this file cannot
 * reach a translator and should not carry English into a German screen.
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
    // Its OWN database. Sharing the original's would make two jobs write one
    // record of what the folders looked like, and the first disagreement
    // between them is a deletion neither job can explain.
    state: `state/${name}.db`,
    // Held, for the reason above. This is the one job in the program that
    // arrives switched off on purpose.
    disabled: true,
  };
}

/**
 * A name nothing else has, by counting up from the one that was wanted.
 *
 * Shared by making a job and copying one, because they are the same question
 * asked twice. It lived in both places, and a source guard on this module found
 * the second copy the moment the first moved here - which is the whole argument
 * for that guard: two implementations of one rule agree right up until somebody
 * improves one of them.
 *
 * From 2, because the first one is the unnumbered one. Counting from 1 would
 * name a lone copy "x-copy-1" and never use "x-copy" at all.
 */
export function uniqueName(base: string, taken: readonly string[]): string {
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base}-${n}`;
  return name;
}
