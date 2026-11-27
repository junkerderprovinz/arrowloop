/**
 * What a job's More menu offers, in groups and in order. The job list and the
 * job's own page draw their menus from it, in the container and on the phone,
 * so one cannot offer what the other lacks. Plain TypeScript, so Metro and the
 * phone's tests can read it.
 */
export const JOB_ACTIONS = [
  ['edit', 'duplicate'],
  ['preview', 'check', 'dupes', 'trash'],
  ['remove'],
] as const

export type JobAction = (typeof JOB_ACTIONS)[number][number]

/**
 * The groups as a menu shows them. The job's own page leaves out Edit: in the
 * container it is a button beside More, and the phone edits the job on that
 * very screen.
 */
export function jobActionGroups(ownPage: boolean): JobAction[][] {
  return JOB_ACTIONS.map((group) => group.filter((action) => !(ownPage && action === 'edit')))
}
