import { Dialog } from './Dialog'
import { FailureText } from './FailureText'
import { RunDetail } from './RunDetail'
import type { Run } from '../lib/api'
import { dayTime } from '../lib/dayTime'
import { useT } from '../lib/i18n'
import { useLiveTick } from '../lib/liveTick'

/**
 * One run in a window: when, what it added up to, why it failed if it did,
 * and every path it touched. A running run is read again while it goes.
 */
export function RunSheet({ run, onClose }: { run: Run; onClose: () => void }) {
  const { t, lang } = useT()
  const tick = useLiveTick(!!run.Running)
  const when = dayTime(run.Started, lang, (p) => t('list.when', p))
  const figures: [string, number][] = [
    [t('history.fig.copied'), run.Copied],
    [t('history.fig.moved'), run.Moved],
    [t('history.fig.trashed'), run.Trashed],
    [t('history.fig.conflicts'), run.Conflicts],
    [t('history.fig.left'), run.Skipped],
  ]
  return (
    <Dialog title={`${run.Job}, ${when}`} onClose={onClose} width="wide">
      <div className="flex flex-col gap-3">
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-subline">
          {figures.map(([term, value]) => (
            <div key={term} className="flex items-baseline gap-1.5">
              <dt className="text-carbon-textSub">{term}</dt>
              <dd className="glim-num font-medium text-carbon-text">{value}</dd>
            </div>
          ))}
        </dl>
        {run.Err && <FailureText raw={run.Err} failure={run.Failure} className="text-statusFail" />}
        <RunDetail run={run.ID} job={run.Job} tick={run.Running ? tick : 0} />
      </div>
    </Dialog>
  )
}
