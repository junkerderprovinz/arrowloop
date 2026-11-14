import { JobMark } from './JobMark'
import { Num } from './Shell'
import type { Run } from '../lib/api'
import { failureLine } from '../lib/failure'
import { useT } from '../lib/i18n'
import { since } from '../lib/since'

/**
 * One run in a short list of the latest: its job, how long ago it ended, and
 * what it moved, why it failed or that it was stopped. `today` counts the
 * job's runs since the morning.
 */
export function RecentRun({ run, today = 0 }: { run: Run; today?: number }) {
  const { t, lang } = useT()
  const failed = run.Err !== ''
  const { count, unit } = since(run.Finished || run.Started)
  const parts = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).formatToParts(-count, unit)
  const counts = [
    run.Copied > 0 ? t('history.copied', { count: run.Copied }) : '',
    run.Moved > 0 ? t('history.moved', { count: run.Moved }) : '',
    run.Trashed > 0 ? t(run.NoTrash ? 'history.deleted' : 'history.trashed', { count: run.Trashed }) : '',
    run.Conflicts > 0 ? t('history.conflicts', { count: run.Conflicts }) : '',
  ].filter(Boolean)
  // A job that runs on every change says how busy it was instead of filling
  // the list with its runs.
  const busy = today > 1 ? t('tray.runsToday', { count: today }) : ''
  const said = failed
    ? failureLine(run.Err, run.Failure, t, lang)
    : run.Stopped
      ? t('history.stopped')
      : counts.length > 0
        ? counts.join(' · ')
        : t('history.ok')
  return (
    <li className="flex items-start gap-2">
      <JobMark status={failed ? 'failed' : run.Stopped ? 'stopped' : 'ok'} size={18} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-body">{run.Job}</span>
          <span className="ms-auto shrink-0 text-subline text-carbon-textMuted" title={new Date(run.Finished || run.Started).toLocaleString(lang)}>
            {parts.map((part, i) => (part.type === 'integer' ? <Num key={i}>{part.value}</Num> : part.value))}
          </span>
        </div>
        <span className={`truncate text-subline ${failed ? 'text-statusFail' : 'text-carbon-textMuted'}`}>
          {busy ? `${said} · ${busy}` : said}
        </span>
      </div>
    </li>
  )
}
