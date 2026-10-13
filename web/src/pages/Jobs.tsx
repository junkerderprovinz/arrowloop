import { useMemo, useState, type MouseEvent } from 'react'

import { Empty, Stack } from '../components/Shell'
import { IconAction } from '../components/IconAction'
import { Menu, type MenuItem } from '../components/Menu'
import { DirectionGlyph, DirectionMark } from '../components/Direction'
import { IconAdd, IconPause, IconPlay } from '../components/glyphs'
import { JobEditor, RemoveJobDialog, useConfigErrors } from '../components/JobEditor'
import { PageAction, PageActions } from '../components/PageActions'
import { JobStatusLine } from '../components/JobStatusLine'
import { RunStrip } from '../components/RunStrip'
import { Card } from '../lib/glimstone/Card'
import { Badge } from '../lib/glimstone/Badge'
import { useJobConfig } from './Editor'
import type { Finding } from '../lib/anomalies'
import { api, type Job, type OpenConflict, type RunEvent } from '../lib/api'
import { describeCadence, readCadence } from '../lib/cadence'
import { dayTime } from '../lib/dayTime'
import { sideName } from '../lib/entryLabel'
import { useGoTo } from '../lib/goTo'
import { useT } from '../lib/i18n'
import { jobCardPlace, type JobPageCard } from '../lib/jobCards'
import { jobStatus } from '../lib/jobList'
import { useOpenJob } from '../lib/openJob'
import { usePlaces } from '../lib/places'
import { navigate } from '../lib/router'
import { useStartStop } from '../lib/startStop'
import { useToast } from '../lib/toast'

/**
 * The jobs page: every job as a card of its own that opens its page, with its
 * status, its last runs, its two everyday buttons and a More menu with what
 * else the job's page offers. Making a job is what the page is for, so it is
 * the corner's action.
 */
export function Jobs({
  jobs,
  findings,
  progress,
  conflicts = [],
  onSaved,
}: {
  jobs: Job[]
  /** The open findings, which decide a held job's status. */
  findings: Finding[]
  progress: Record<string, RunEvent>
  /** The conflicts waiting for an answer, across every job. */
  conflicts?: Pick<OpenConflict, 'job'>[]
  onSaved: () => void
}) {
  const { t } = useT()
  const push = useToast()
  const goTo = useGoTo()
  const config = useJobConfig(onSaved)
  useConfigErrors(config)
  const [editing, setEditing] = useState<{ at: number; added: boolean } | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)
  const conflicted = useMemo(() => new Set(conflicts.map((c) => c.job)), [conflicts])
  const shown = useMemo(() => [...jobs].sort((a, b) => a.name.localeCompare(b.name)), [jobs])

  // Entries in the configuration the engine does not run, such as a job saved
  // with a side still empty, are listed so they can be finished.
  const drafts = (config.jobs ?? [])
    .map((job, at) => ({ job, at }))
    .filter(({ job, at }) => !jobs.some((j) => j.name === job.name) && at !== editing?.at)

  const nothing = jobs.length === 0 && drafts.length === 0
  // Paused jobs and drafts stay out of "run all", as they would on a schedule.
  const ready = jobs.filter((j) => !j.disabled && !j.running && j.left && j.right)
  const running = jobs.filter((j) => j.running)

  // The engine starts and stops one job at a time, so every job is asked on
  // its own and one refusal leaves the others going.
  function everyJob(names: string[], act: (name: string) => Promise<unknown>) {
    void Promise.allSettled(names.map((name) => act(name))).then((answers) => {
      const refused = answers.find((a): a is PromiseRejectedResult => a.status === 'rejected')
      if (refused) push((refused.reason as Error).message, 'fail')
    })
  }

  // What the job's page offers beyond Pause and Run now. The windows open
  // here; the preview, the check and the duplicate search are cards on the
  // job's page and open it at theirs. Only a job in the configuration file
  // can be edited, copied or removed.
  function moreFor(name: string): MenuItem[] {
    const at = config.jobs?.findIndex((raw) => raw.name === name) ?? -1
    const card = (which: JobPageCard) => () => navigate(jobCardPlace(name, which))
    const saved: MenuItem[] =
      at === -1
        ? []
        : [
            { label: t('job.edit'), labelKey: 'job.edit', onSelect: () => setEditing({ at, added: false }) },
            {
              label: t('edit.duplicate'),
              labelKey: 'edit.duplicate',
              onSelect: () => setEditing({ at: config.duplicate(at), added: true }),
            },
          ]
    return [
      ...saved,
      { label: t('jobs.preview'), labelKey: 'jobs.preview', onSelect: card('preview') },
      { label: t('jobs.check'), labelKey: 'jobs.check', onSelect: card('check') },
      { label: t('jobs.dupes'), labelKey: 'jobs.dupes', onSelect: card('dupes') },
      { label: t('edit.openTrash'), labelKey: 'edit.openTrash', onSelect: () => goTo({ tab: 'trash', job: name }) },
      ...(at === -1 ? [] : [{ label: t('edit.remove'), labelKey: 'edit.remove' as const, onSelect: () => setRemoving(at) }]),
    ]
  }

  return (
    <Stack>
      {nothing ? (
        <Card title={t('nav.jobs')} hueIndex={0}>
          <Empty>{t('jobs.none')}</Empty>
        </Card>
      ) : (
        <ul className="flex flex-col gap-10">
          {shown.map((j, i) => (
            <JobCard
              key={j.name}
              job={j}
              hueIndex={i}
              held={findings.find((f) => f.held && f.job === j.name)}
              note={findings.find((f) => !f.held && f.job === j.name)}
              conflict={conflicted.has(j.name)}
              event={progress[j.name]}
              busy={config.busy}
              canPause={config.jobs?.some((raw) => raw.name === j.name) ?? false}
              onPause={() => void config.setDisabled(j.name, !j.disabled)}
              more={moreFor(j.name)}
            />
          ))}
          {drafts.map(({ job, at }, i) => (
            <DraftCard
              key={`draft-${at}`}
              name={job.name || t('edit.unnamed')}
              hueIndex={shown.length + i}
              onOpen={() => setEditing({ at, added: false })}
            />
          ))}
        </ul>
      )}

      {editing && config.jobs?.[editing.at] && (
        <JobEditor config={config} at={editing.at} added={editing.added} onClose={() => setEditing(null)} />
      )}
      {removing !== null && <RemoveJobDialog config={config} at={removing} onClose={() => setRemoving(null)} />}

      <PageActions>
        <Menu
          label={t('list.more')}
          labelKey="list.more"
          size="key"
          items={[
            {
              label: t('jobs.runAll'),
              labelKey: 'jobs.runAll',
              disabled: ready.length === 0,
              onSelect: () => everyJob(ready.map((j) => j.name), api.run),
            },
            {
              label: t('jobs.stopAll'),
              labelKey: 'jobs.stopAll',
              disabled: running.length === 0,
              onSelect: () => everyJob(running.map((j) => j.name), api.stopJob),
            },
          ]}
        />
        <PageAction
          primary
          label={t('edit.add')}
          labelKey="edit.add"
          glyph={<IconAdd />}
          disabled={!config.jobs}
          onClick={() => {
            const at = config.add()
            if (at !== null) setEditing({ at, added: true })
          }}
        />
      </PageActions>
    </Stack>
  )
}

// A click on something inside the card that acts by itself must not open the card.
function keepInCard(e: MouseEvent) {
  e.stopPropagation()
}

/**
 * One job as a card that opens its page wherever it is clicked: its name in
 * the notch, the tile of its direction, what it joins and when it runs, its
 * last runs with its one status after them, and More beside its two everyday
 * buttons.
 */
function JobCard({
  job,
  hueIndex,
  held,
  note,
  conflict,
  event,
  busy,
  canPause,
  onPause,
  more,
}: {
  job: Job
  hueIndex: number
  /** The finding that holds the job, if a brake does. */
  held?: Finding
  /** A finding about the job that does not hold it. */
  note?: Finding
  /** Whether a conflict of this job waits for an answer. */
  conflict: boolean
  event?: RunEvent
  busy: boolean
  /** Only a job in the configuration file can be paused from here. */
  canPause: boolean
  onPause: () => void
  /** The job page's further actions. */
  more: MenuItem[]
}) {
  const { t, lang } = useT()
  const open = useOpenJob()
  const { drives } = usePlaces()
  const status = jobStatus(job, { held: !!held, conflict, notes: !!note })
  const startStop = useStartStop(job)

  return (
    <li data-testid="job-row" data-new-way="/jobs/:name" onClick={() => open(job.name)} className="relative cursor-pointer">
      <CardName name={job.name} />
      <Card title={job.name} hueIndex={hueIndex}>
        {/* Two blocks centred on each other: what the job joins on the left,
            and on the right its last runs ending in its status, above its
            buttons. Where the window is too narrow for both, the right block
            moves under the left one. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className="flex min-w-0 flex-1 basis-72 items-center gap-4">
            <span className="glim-row-glyph flex h-10 w-10 shrink-0 items-center justify-center rounded-control [&_svg]:h-5 [&_svg]:w-5">
              <DirectionGlyph direction={job.direction} flowing={job.running} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-subline text-carbon-textSub">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                <span className="min-w-0 [overflow-wrap:anywhere]">{sideName(job.left, drives)}</span>
                <DirectionMark direction={job.direction} />
                <span className="min-w-0 [overflow-wrap:anywhere]">{sideName(job.right, drives)}</span>
              </span>
              <span className="flex flex-wrap gap-x-4">
                <span>{t('jobs.runs', { cadence: describeCadence(readCadence(job.schedule ?? '', !!job.watch), t) })}</span>
                {job.nextRun && !job.disabled && (
                  <span>{t('jobs.fact.next', { when: dayTime(job.nextRun, lang, (p) => t('list.when', p)) })}</span>
                )}
              </span>
            </span>
          </span>
          <span className="ms-auto flex min-w-0 max-w-full flex-col items-end gap-3">
            <span className="flex flex-wrap items-center justify-end gap-3">
              <span data-new="run-strip" className="flex">
                <RunStrip recent={job.recent} />
              </span>
              <span data-testid="job-status" className="flex justify-end">
                <JobStatusLine job={job} status={status} heldFinding={held?.id} noteFinding={note?.id} event={event} />
              </span>
            </span>
            {/* Holding and starting are separate controls: a held job can still
                be started by hand, and stays held. */}
            <span data-testid="job-actions" className="flex flex-wrap items-center justify-end gap-1.5" onClick={keepInCard}>
              <span data-new="job-more" className="flex">
                <Menu label={t('list.more')} labelKey="list.more" items={more} />
              </span>
              {canPause && (
                <IconAction
                  title={job.disabled ? t('jobs.resume') : t('jobs.pause')}
                  labelKey={job.disabled ? 'jobs.resume' : 'jobs.pause'}
                  hint={job.disabled ? undefined : t('jobs.pauseHint')}
                  disabled={busy}
                  onClick={onPause}
                >
                  {job.disabled ? <IconPlay /> : <IconPause />}
                </IconAction>
              )}
              <IconAction
                title={startStop.label}
                labelKey={startStop.labelKey}
                hint={startStop.hint}
                disabled={startStop.disabled}
                onClick={startStop.press}
              />
            </span>
          </span>
        </div>
      </Card>
    </li>
  )
}

/**
 * The card's name as a button for the keyboard and screen readers, spread over
 * the card so its focus ring goes round it. A pointer passes through to the
 * card underneath, and a press of Enter reaches the card's click as well.
 */
function CardName({ name }: { name: string }) {
  return <button type="button" aria-label={name} className="pointer-events-none absolute inset-0 z-10 rounded-card" />
}

/** A job the configuration holds but the engine does not run yet, which opens in the editor. */
function DraftCard({ name, hueIndex, onOpen }: { name: string; hueIndex: number; onOpen: () => void }) {
  const { t } = useT()
  return (
    <li className="relative cursor-pointer" onClick={onOpen}>
      <CardName name={name} />
      <Card title={name} hueIndex={hueIndex}>
        <span className="flex items-center gap-3">
          <span className="glim-row-glyph flex h-10 w-10 shrink-0 items-center justify-center rounded-control [&_svg]:h-5 [&_svg]:w-5">
            <DirectionGlyph direction="both" />
          </span>
          <Badge tone="neutral">{t('edit.unsaved')}</Badge>
        </span>
      </Card>
    </li>
  )
}
