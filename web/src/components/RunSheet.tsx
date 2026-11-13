import { useState } from 'react'

import { Dialog } from './Dialog'
import { FailureText } from './FailureText'
import { IconClose, IconExport } from './glyphs'
import { RunDetail } from './RunDetail'
import type { Run, RunEntry } from '../lib/api'
import { dayTime } from '../lib/dayTime'
import { download } from '../lib/download'
import { Button } from '../lib/glimstone/Button'
import { useT } from '../lib/i18n'
import { useLiveTick } from '../lib/liveTick'

// Codepoints rather than escapes: a tab mangled into a space still looks right
// but breaks the columns.
const TAB = String.fromCharCode(9)
const NEWLINE = String.fromCharCode(10)

/**
 * One run in a window: when, what it added up to, why it failed if it did,
 * and every path it touched. A running run is read again while it goes. Every
 * run's window shares one size, the last one dragged to.
 */
export function RunSheet({ run, onClose }: { run: Run; onClose: () => void }) {
  const { t, lang } = useT()
  const tick = useLiveTick(!!run.Running)
  const [entries, setEntries] = useState<RunEntry[]>([])
  const when = dayTime(run.Started, lang, (p) => t('list.when', p))
  const figures: [string, number][] = [
    [t('history.fig.copied'), run.Copied],
    [t('history.fig.moved'), run.Moved],
    [t(run.NoTrash ? 'history.fig.deleted' : 'history.fig.trashed'), run.Trashed],
    [t('history.fig.conflicts'), run.Conflicts],
    [t('history.fig.left'), run.Skipped],
  ]
  return (
    <Dialog
      title={`${run.Job}, ${when}`}
      onClose={onClose}
      width="wide"
      sizeKey="run"
      footer={
        <>
          <Button label={t('common.close')} labelKey="common.close" glyph={<IconClose />} onClick={onClose} />
          {/* Tab-separated plain text, so a run that went wrong can be sent on. */}
          <Button
            label={t('history.download')}
            labelKey="history.download"
            glyph={<IconExport />}
            disabled={entries.length === 0}
            onClick={() => {
              const lines = entries.map((e) => [e.Kind, e.Side, e.Path, e.Note].join(TAB))
              download(`arrowloop-${run.Job}-${run.ID}.txt`, lines.join(NEWLINE) + NEWLINE)
            }}
          />
        </>
      }
    >
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
        <RunDetail run={run.ID} job={run.Job} tick={run.Running ? tick : 0} onEntries={setEntries} />
      </div>
    </Dialog>
  )
}
