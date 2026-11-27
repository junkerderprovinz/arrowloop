/** A job's runAtStart as the engine writes it: true for every start, "due" for a start when it is due. */
export type RunAtStart = boolean | 'due'

export type AtStartChoice = 'off' | 'always' | 'due'

export const AT_START: AtStartChoice[] = ['off', 'always', 'due']

export function atStartOf(value: RunAtStart | undefined): AtStartChoice {
  if (value === 'due') return 'due'
  return value ? 'always' : 'off'
}

/** What a choice writes. Off leaves the key out, which is how a job that waits for its schedule reads. */
export function runAtStartFor(choice: AtStartChoice): RunAtStart | undefined {
  if (choice === 'off') return undefined
  return choice === 'always' ? true : 'due'
}
