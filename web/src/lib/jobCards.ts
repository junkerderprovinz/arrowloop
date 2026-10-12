/** The cards on a job's page that another page can send somebody to, by element id. */
export const JOB_CARDS = { preview: 'job-preview', check: 'job-check', dupes: 'job-dupes' } as const

export type JobPageCard = keyof typeof JOB_CARDS

/** The card named in an address, or null for none or a name the page has no card for. */
export function readJobCard(value: string | null): JobPageCard | null {
  return value !== null && Object.prototype.hasOwnProperty.call(JOB_CARDS, value) ? (value as JobPageCard) : null
}

/** The address of a job's page opened at one of its cards. */
export function jobCardPlace(job: string, card: JobPageCard): string {
  return `/jobs/${encodeURIComponent(job)}?card=${card}`
}
