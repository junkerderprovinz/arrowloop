import { IconClose } from './glyphs'
import { IconAction } from './IconAction'
import { useT } from '../lib/i18n'

/**
 * The job a link from another page narrowed this one to, as a pill whose cross
 * shows every job again. A page with a handful of jobs needs no filter of its
 * own; this only carries the narrowing the link asked for.
 */
export function JobChip({ job, onClear }: { job: string; onClear: () => void }) {
  const { t } = useT()
  if (!job) return null
  return (
    <div className="flex">
      <span
        className="inline-flex min-w-0 items-center gap-1 bg-carbon-surface2 py-0.5 pe-0.5 ps-3 text-subline text-carbon-text"
        style={{ borderRadius: 'var(--radius-pill)' }}
      >
        <span className="min-w-0 [overflow-wrap:anywhere]">{t('list.onlyJob', { job })}</span>
        <IconAction title={t('list.everyJob')} labelKey="list.everyJob" tone="subtle" onClick={onClear}>
          <IconClose />
        </IconAction>
      </span>
    </div>
  )
}
