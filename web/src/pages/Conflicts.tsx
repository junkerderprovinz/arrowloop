import { useEffect, useMemo, useState } from 'react'

import { Empty, Rows, Rule, Stack } from '../components/Shell'
import { Choice } from '../components/Field'
import { Card } from '../lib/glimstone/Card'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { Toggle } from '../lib/glimstone/Toggle'
import { ApiError, api, type ConflictListing, type OpenConflict, type Resolution } from '../lib/api'
import { conflictKey, decisionsByJob, newerSide, stillListed } from '../lib/conflicts'
import { useT, type TranslationKey } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { Since } from './Jobs'
import { Version } from './Preview'

/** The three answers in the order they stand on every row: holding back first, then the two that pick. */
const CHOICES: { keep: Resolution; key: TranslationKey }[] = [
  { keep: 'both', key: 'conflict.keepBoth' },
  { keep: 'left', key: 'conflict.keepLeft' },
  { keep: 'right', key: 'conflict.keepRight' },
]

/**
 * Every conflict a run kept both versions of that nobody has decided, across
 * all jobs. A choice runs the job's decision at once; the version that loses
 * goes to the trash, so a wrong click is undone from there.
 */
export function Conflicts({
  listing,
  job: startJob,
  onChanged,
}: {
  /** Null until the first answer arrives. */
  listing: ConflictListing | null
  /** The job to show first, when another screen sent somebody here for one. */
  job: string
  /** Asks for a job's conflicts and trash again after something was decided. */
  onChanged: (job: string) => void
}) {
  const { t } = useT()
  const push = useToast()
  const [job, setJob] = useState(startJob)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const all = listing?.conflicts ?? []
  const shown = job ? all.filter((c) => c.job === job) : all
  const chosen = shown.filter((c) => selected.has(conflictKey(c)))

  // A decided conflict leaves the list, and its selection with it.
  useEffect(() => setSelected((prev) => stillListed(prev, listing?.conflicts ?? [])), [listing])

  const jobs = useMemo(() => [...new Set(all.map((c) => c.job))].sort((a, b) => a.localeCompare(b)), [all])

  async function decide(rows: OpenConflict[], keep: Resolution) {
    const keys = new Set(rows.map(conflictKey))
    setBusy(keys)
    setError(null)
    let decided = 0
    for (const [name, decisions] of decisionsByJob(rows, keep)) {
      try {
        const { run } = await api.decide(name, decisions)
        decided += decisions.length - run.Skipped
        if (run.Skipped > 0) setError(t('conflicts.skipped', { count: run.Skipped }))
      } catch (e) {
        setError(e instanceof ApiError && e.status === 409 ? t('conflicts.running', { job: name }) : (e as Error).message)
      }
      onChanged(name)
    }
    if (decided > 0) push(t('conflicts.decided', { count: decided }))
    setBusy(new Set())
  }

  const toggle = (key: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const everyShownChosen = shown.length > 0 && chosen.length === shown.length

  return (
    <Stack>
      <Card title={t('nav.conflicts')} hueIndex={0} hint={t('conflicts.hint')}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="w-56 shrink-0">
            <Choice
              label={t('history.filterJob')}
              value={job}
              onChange={setJob}
              options={[
                { value: '', label: t('history.allJobs') },
                ...[...new Set([...jobs, ...(job ? [job] : [])])].map((n) => ({ value: n, label: n })),
              ]}
            />
          </div>
          <Toggle
            label={t('conflicts.selectAll')}
            checked={everyShownChosen}
            disabled={shown.length === 0}
            onChange={(on) => setSelected(on ? new Set([...selected, ...shown.map(conflictKey)]) : new Set())}
          />
          {/* The answers for everything chosen; the same three stand on each
              row for one conflict at a time. */}
          <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
            <span className="glim-num text-xs text-carbon-textMuted">{t('conflicts.chosen', { count: chosen.length })}</span>
            {CHOICES.map(({ keep, key }) => (
              <Button
                key={keep}
                label={t(key)}
                labelKey={key}
                tone="neutral"
                disabled={chosen.length === 0 || busy.size > 0}
                onClick={() => void decide(chosen, keep)}
              />
            ))}
            <InfoBubble tip={t('conflicts.chooseHint')} />
          </div>
        </div>

        {error && <p className="mb-3 text-xs text-statusFail">{error}</p>}

        {listing === null ? (
          <Empty>{t('history.working')}</Empty>
        ) : shown.length === 0 ? (
          <Empty>{job ? t('conflicts.noneInJob') : t('conflicts.none')}</Empty>
        ) : (
          <Rows className="glim-content-fade flex flex-col">
            {shown.map((c, i) => (
              <li key={conflictKey(c)}>
                {i > 0 && <Rule />}
                <Row
                  conflict={c}
                  withJob={!job}
                  selected={selected.has(conflictKey(c))}
                  onSelect={(on) => toggle(conflictKey(c), on)}
                  busy={busy.has(conflictKey(c))}
                  idle={busy.size === 0}
                  onDecide={(keep) => void decide([c], keep)}
                />
              </li>
            ))}
          </Rows>
        )}

        {listing?.unread.map((u) => (
          <p key={u.job} className="mt-3 text-xs text-statusFail">
            {t('conflicts.unread', { job: u.job, error: u.error })}
          </p>
        ))}
      </Card>
    </Stack>
  )
}

function Row({
  conflict: c,
  withJob,
  selected,
  onSelect,
  busy,
  idle,
  onDecide,
}: {
  conflict: OpenConflict
  /** Whether to name the job, which a list narrowed to one job does not need. */
  withJob: boolean
  selected: boolean
  onSelect: (on: boolean) => void
  busy: boolean
  /** False while any decision is under way, so two cannot race for one job. */
  idle: boolean
  onDecide: (keep: Resolution) => void
}) {
  const { t } = useT()
  const newer = newerSide(c)
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Toggle label={t('conflicts.select')} hideLabel checked={selected} onChange={onSelect} />
        <span className="min-w-0 flex-1 break-all font-mono text-xs text-carbon-text">{c.plain}</span>
        {withJob && <Badge tone="neutral">{c.job}</Badge>}
        <span className="shrink-0 text-xs text-carbon-textMuted">
          <Since when={c.at} />
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Version side={t('side.left')} version={c.left} newer={newer === 'left'} />
        <Version side={t('side.right')} version={c.right} newer={newer === 'right'} />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {CHOICES.map(({ keep, key }) => (
          <Button
            key={keep}
            label={t(key)}
            labelKey={key}
            tone="neutral"
            busy={busy}
            disabled={!idle}
            onClick={() => onDecide(keep)}
          />
        ))}
      </div>
    </div>
  )
}
