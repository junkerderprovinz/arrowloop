import { useState } from 'react'

import { JobChip } from '../components/JobChip'
import { Menu } from '../components/Menu'
import { PageActions } from '../components/PageActions'
import { Empty, Num, Stack } from '../components/Shell'
import { Since } from '../components/Since'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { ConfirmDialog } from '../lib/glimstone/ConfirmDialog'
import { ApiError, api, type ConflictListing, type Job, type OpenConflict, type Resolution, type SideVersion } from '../lib/api'
import { bytes } from '../lib/bytes'
import { conflictKey, decisionsByJob, newerSide } from '../lib/conflicts'
import { sideName } from '../lib/entryLabel'
import { failureLine } from '../lib/failure'
import { useT, type TranslationKey } from '../lib/i18n'
import { useLive } from '../lib/live'
import { usePlaces } from '../lib/places'
import { useToast } from '../lib/toast'

/** The three answers in the order they stand everywhere: holding back first, then the two that pick. */
const CHOICES: { keep: Resolution; key: TranslationKey; all: TranslationKey }[] = [
  { keep: 'both', key: 'conflict.answerBoth', all: 'conflicts.allBoth' },
  { keep: 'left', key: 'conflict.answerLeft', all: 'conflicts.allLeft' },
  { keep: 'right', key: 'conflict.answerRight', all: 'conflicts.allRight' },
]

/** What the engine says caused a conflict, in a sentence, keyed by its reason code. */
const WHY: Record<string, TranslationKey> = {
  changedBoth: 'conflict.why.changedBoth',
  appearedDiffer: 'conflict.why.appearedDiffer',
}

/**
 * Every conflict a run kept both versions of that nobody has decided, in a
 * card per job. Each conflict says which file it is, what went wrong and what
 * each side holds, with the three answers under it; a choice runs the job's
 * decision at once, and the version that loses goes to the trash, so a wrong
 * click is undone from there. From two conflicts up, one answer for all of
 * them waits in the corner and asks first, naming how many it decides.
 */
export function Conflicts({
  listing,
  job,
  onJob,
  onChanged,
}: {
  /** Null until the first answer arrives. */
  listing: ConflictListing | null
  /** The job the address narrows the page to, empty for every job. */
  job: string
  /** Narrows the page to another job, by changing the address. */
  onJob: (job: string) => void
  /** Asks for a job's conflicts and trash again after something was decided. */
  onChanged: (job: string) => void
}) {
  const { t, lang } = useT()
  const push = useToast()
  const live = useLive()
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [asking, setAsking] = useState<(typeof CHOICES)[number] | null>(null)

  const shown = (listing?.conflicts ?? []).filter((c) => !job || c.job === job)
  const groups = [...new Set(shown.map((c) => c.job))].map((name) => ({
    name,
    job: live.jobs.find((j) => j.name === name),
    conflicts: shown.filter((c) => c.job === name),
  }))
  const unread = (listing?.unread ?? []).filter((u) => !job || u.job === job)

  async function decide(rows: OpenConflict[], keep: Resolution) {
    setBusy(new Set(rows.map(conflictKey)))
    let decided = 0
    for (const [name, decisions] of decisionsByJob(rows, keep)) {
      try {
        const { run } = await api.decide(name, decisions)
        decided += decisions.length - run.Skipped
        if (run.Skipped > 0) push(t('conflicts.skipped', { count: run.Skipped }), 'fail')
      } catch (e) {
        push(e instanceof ApiError && e.status === 409 ? t('conflicts.running', { job: name }) : (e as Error).message, 'fail')
      }
      onChanged(name)
    }
    if (decided > 0) push(t('conflicts.decided', { count: decided }))
    setBusy(new Set())
  }

  return (
    <Stack>
      <JobChip job={job} onClear={() => onJob('')} />

      {listing === null ? (
        <Card title={t('nav.conflicts')} hueIndex={0}>
          <Empty>{t('history.working')}</Empty>
        </Card>
      ) : groups.length === 0 && unread.length === 0 ? (
        <Card title={t('nav.conflicts')} hueIndex={0} hint={t('conflicts.hint')}>
          <Empty>{job ? t('conflicts.noneInJob') : t('conflicts.none')}</Empty>
        </Card>
      ) : (
        groups.map((g, i) => (
          <div key={g.name} data-new={i === 0 ? 'conflict-cards' : undefined}>
            <Card title={g.name} hueIndex={i} hint={t('conflicts.hint')}>
              <ul className="flex flex-col gap-2.5">
                {g.conflicts.map((c) => {
                  const key = conflictKey(c)
                  return (
                    <ConflictCard
                      key={key}
                      conflict={c}
                      job={g.job}
                      busy={busy.has(key)}
                      idle={busy.size === 0}
                      onDecide={(keep) => void decide([c], keep)}
                    />
                  )
                })}
              </ul>
            </Card>
          </div>
        ))
      )}

      {unread.map((u, i) => (
        <Card key={u.job} title={u.job} hueIndex={groups.length + i}>
          <p className="text-subline text-statusFail [overflow-wrap:anywhere]">{t('conflicts.unread', { job: u.job, error: failureLine(u.error, u.failure, t, lang) })}</p>
        </Card>
      ))}

      {asking && (
        <ConfirmDialog
          title={t(asking.all)}
          message={t('conflicts.allConfirm', { count: shown.length }) + ' ' + t('conflicts.chooseHint')}
          confirmLabel={t(asking.all)}
          confirmLabelKey={asking.all}
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            void decide(shown, asking.keep)
            setAsking(null)
          }}
        />
      )}

      {/* One answer for every conflict on the page; for a single conflict the
          card's own three say the same. */}
      {shown.length > 1 && (
        <PageActions>
          <Menu
            label={t('list.more')}
            labelKey="list.more"
            size="key"
            items={CHOICES.map((choice) => ({
              label: t(choice.all),
              labelKey: choice.all,
              disabled: busy.size > 0,
              onSelect: () => setAsking(choice),
            }))}
          />
        </PageActions>
      )}
    </Stack>
  )
}

/**
 * One conflict, readable without opening anything: the file, what went wrong,
 * what each side's version is and where it sits now, and the three answers in
 * words that say what each does.
 */
function ConflictCard({
  conflict: c,
  job,
  busy,
  idle,
  onDecide,
}: {
  conflict: OpenConflict
  job?: Job
  busy: boolean
  /** False while any decision is under way, so two cannot race for one job. */
  idle: boolean
  onDecide: (keep: Resolution) => void
}) {
  const { t } = useT()
  const { drives } = usePlaces()
  const newer = newerSide(c)
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-card bg-carbon-surface2 px-4 pb-3.5 pt-3 max-sm:px-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span dir="ltr" className="min-w-0 flex-1 text-start font-mono text-title font-semibold text-carbon-text [overflow-wrap:anywhere]">
          {c.plain}
        </span>
        <span className="shrink-0 text-subline text-carbon-textMuted">
          {t('conflict.metAt')} <Since when={c.at} />
        </span>
      </div>
      <p className="text-body text-carbon-text">{t(WHY[c.why ?? ''] ?? 'conflict.why.unknown')}</p>

      <div className="grid gap-2 sm:grid-cols-2">
        {(['left', 'right'] as const).map((side) => (
          <SideHolds
            key={side}
            label={t(side === 'left' ? 'edit.left' : 'edit.right')}
            place={job ? sideName(job[side], drives) : undefined}
            version={c[side]}
            newer={newer === side}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {CHOICES.map(({ keep, key }) => (
          <Button
            key={keep}
            label={t(key)}
            labelKey={key}
            busy={busy}
            disabled={!idle}
            className="glim-btn-wrap"
            onClick={() => onDecide(keep)}
          />
        ))}
      </div>
    </li>
  )
}

/** What one side's version is: where the side is, how big and how old the file is, and its name now. */
function SideHolds({ label, place, version, newer }: { label: string; place?: string; version: SideVersion; newer: boolean }) {
  const { t, lang } = useT()
  const modified = new Intl.DateTimeFormat(lang, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(version.mod))
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-control bg-carbon-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="glim-eyebrow">{label}</span>
        {newer && <Badge tone="ok">{t('conflict.newer')}</Badge>}
      </div>
      {place && (
        <p dir="ltr" className="text-start text-subline text-carbon-textSub [overflow-wrap:anywhere]">
          {place}
        </p>
      )}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-subline">
        <dt className="text-carbon-textSub">{t('conflict.size')}</dt>
        <dd className="text-carbon-text">
          <Num>{bytes(version.size)}</Num>
        </dd>
        <dt className="text-carbon-textSub">{t('conflict.changed')}</dt>
        <dd className="text-carbon-text">{modified}</dd>
        <dt className="text-carbon-textSub">{t('conflict.namedNow')}</dt>
        <dd dir="ltr" className="text-start font-mono text-carbon-text [overflow-wrap:anywhere]">
          {version.path.split('/').pop()}
        </dd>
      </dl>
    </div>
  )
}
