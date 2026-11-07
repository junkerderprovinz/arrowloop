import { useRemembered } from './remember'

export type JobView = 'cards' | 'compact'

const isJobView = (v: unknown): v is JobView => v === 'cards' || v === 'compact'

/** How the Jobs page draws the jobs, chosen under Settings, Look and kept in this browser. */
export function useJobView(): [JobView, (next: JobView) => void] {
  return useRemembered<JobView>('arrowloop.jobs.view', 'cards', isJobView)
}
