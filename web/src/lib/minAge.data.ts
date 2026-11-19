// How old a file has to be before a one-way job sends it, as the editors on
// the web and the phone offer it. Shared, so both write the same days.

/** The ages offered as one tap, in days. Anything else is typed. */
export const MIN_AGE_PRESETS = [7, 30, 60, 120] as const

export type MinAgeChoice = 'off' | `${(typeof MIN_AGE_PRESETS)[number]}` | 'custom'

/** Where a typed age starts when nothing was set before: two weeks, between the first two presets. */
export const FIRST_CUSTOM = 14

/** The most days the engine takes, a century. */
export const MAX_MIN_AGE = 36500

/** The segment a job's days show as. `custom` also covers a typed age the presets happen to match. */
export function minAgeChoice(days: number | undefined, custom: boolean): MinAgeChoice {
  if (custom) return 'custom'
  if (!days || days <= 0) return 'off'
  return (MIN_AGE_PRESETS as readonly number[]).includes(days) ? (String(days) as MinAgeChoice) : 'custom'
}

/** The days a picked segment writes. Off writes nothing, so the field leaves the file. */
export function minAgeDays(choice: MinAgeChoice, current: number): number | undefined {
  if (choice === 'off') return undefined
  if (choice === 'custom') return current > 0 ? current : FIRST_CUSTOM
  return Number(choice)
}
