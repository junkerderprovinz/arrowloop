import type { MenuEntry } from '../components/Menu'
import type { TranslationKey } from './i18n'
import { jobActionGroups, type JobAction } from './jobActions.data'

const LABEL: Record<JobAction, TranslationKey> = {
  edit: 'job.edit',
  duplicate: 'edit.duplicate',
  preview: 'jobs.preview',
  check: 'jobs.check',
  dupes: 'jobs.dupes',
  trash: 'edit.openTrash',
  remove: 'edit.remove',
}

/**
 * A job's More menu with a line between its groups. An action given no
 * handler stays in its place, disabled, such as Edit while the configuration
 * file is still being read.
 */
export function jobMenu(
  t: (key: TranslationKey) => string,
  handlers: Partial<Record<JobAction, () => void>>,
  ownPage = false,
): MenuEntry[] {
  return jobActionGroups(ownPage).flatMap((group, i) => [
    ...(i > 0 ? (['-'] as const) : []),
    ...group.map((action) => {
      const run = handlers[action]
      return { label: t(LABEL[action]), labelKey: LABEL[action], onSelect: run ?? (() => undefined), disabled: !run }
    }),
  ])
}
