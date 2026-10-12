import { useMemo, useState, type MouseEvent } from 'react'

import { Empty, Rows, Stack } from '../components/Shell'
import { IconAction } from '../components/IconAction'
import { Menu } from '../components/Menu'
import { DirectionGlyph, directionKey } from '../components/Direction'
import { IconAdd, IconPause, IconPlay } from '../components/glyphs'
import { JobEditor, useConfigErrors } from '../components/JobEditor'
import { FilterButton, FilterChoice, ListBar, SearchFold, SortButton } from '../components/ListBar'
import { NeedsCard, StatusHead } from '../components/NeedsHead'
import { PageAction, PageActions } from '../components/PageActions'
import { JobStatusLine } from '../components/JobStatusLine'
import { RunStrip } from '../components/RunStrip'
import { Card } from '../lib/glimstone/Card'
import { Badge } from '../lib/glimstone/Badge'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { useJobConfig } from './Editor'
import type { Finding } from '../lib/anomalies'
import { api, type Job, type OpenConflict, type RunEvent } from '../lib/api'
import { describeCadence, readCadence } from '../lib/cadence'
import { dayTime } from '../lib/dayTime'
import { sideName } from '../lib/entryLabel'
import { useT, type TranslationKey } from '../lib/i18n'
import { DEFAULT_VIEW, JOB_FILTERS, jobStatus, jobsInView, type JobFilter, type JobView } from '../lib/jobList'
import { jobState, needs } from '../lib/needs'
import { useOpenJob } from '../lib/openJob'
import { usePlaces } from '../lib/places'
import { useRemembered } from '../lib/remember'
import { useToast } from '../lib/toast'

const FILTER_LABEL: Record<JobFilter, TranslationKey> = {
  all: 'jobs.filter.all',
  running: 'jobs.filter.running',
  paused: 'jobs.filter.paused',
  trouble: 'jobs.filter.trouble',
}

const SORTS: { value: string; label: TranslationKey; sort: JobView['sort'] }[] = [
  { value: 'name', label: 'list.sort.nameAz', sort: { field: 'name', reversed: false } },
  { value: 'name-', label: 'list.sort.nameZa', sort: { field: 'name', reversed: true } },
  { value: 'status', label: 'list.sort.problemsFirst', sort: { field: 'status', reversed: false } },
  { value: 'status-', label: 'list.sort.problemsLast', sort: { field: 'status', reversed: true } },
  { value: 'lastRun', label: 'list.sort.newestFirst', sort: { field: 'lastRun', reversed: false } },
  { value: 'lastRun-', label: 'list.sort.oldestFirst', sort: { field: 'lastRun', reversed: true } },
]

const sortValue = (sort: JobView['sort']) => `${sort.field}${sort.reversed ? '-' : ''}`

function isView(value: unknown): value is JobView {
  const v = value as JobView
  return (
    !!v &&
    JOB_FILTERS.includes(v.filter) &&
    !!v.sort &&
    SORTS.some((s) => s.value === sortValue(v.sort))
  )
}

/**
 * The jobs page: the state of everything in one sentence, what waits for a
 * person while something does, and every job as one row that opens its page.
 * Making a job is what the page is for, so it is the corner's action.
 */
export function Jobs({
  jobs,
  findings,
  progress,
  conflicts = [],
  unread = 0,
  onSaved,
}: {
  jobs: Job[]
  /** The open findings, which decide the head and a held job's status. */
  findings: Finding[]
  progress: Record<string, RunEvent>
  /** The conflicts waiting for an answer, across every job. */
  conflicts?: Pick<OpenConflict, 'job'>[]
  /** How many conflict lists could not be read, which may hide one waiting. */
  unread?: number
  onSaved: () => void
}) {
  const { t } = useT()
  const push = useToast()
  const config = useJobConfig(onSaved)
  useConfigErrors(config)
  const [editing, setEditing] = useState<{ at: number; added: boolean } | null>(null)
  const [view, setView] = useRemembered<JobView>('arrowloop.jobs.view', DEFAULT_VIEW, isView)
  const [query, setQuery] = useState('')

  const waiting = needs(conflicts.length, findings, jobs.map(jobState), unread)
  const held = useMemo(() => new Set(findings.filter((f) => f.held).map((f) => f.job)), [findings])
  const noted = useMemo(() => new Set(findings.filter((f) => !f.held).map((f) => f.job)), [findings])
  const conflicted = useMemo(() => new Set(conflicts.map((c) => c.job)), [conflicts])
  const waits = (name: string) => ({ held: held.has(name), conflict: conflicted.has(name), notes: noted.has(name) })
  const shown = jobsInView(jobs, view, query, waits)

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

  return (
    <Stack>
      <StatusHead head={waiting.head} />
      <NeedsCard items={waiting.items} findings={findings} hueIndex={0} />

      <div className="flex flex-col gap-6">
        {!nothing && (
          <ListBar newId="list-bar">
            <FilterButton active={view.filter !== 'all'}>
              <FilterChoice<JobFilter>
                label={t('jobs.filter.label')}
                value={view.filter}
                onChange={(filter) => setView({ ...view, filter })}
                options={JOB_FILTERS.map((f) => ({ value: f, label: t(FILTER_LABEL[f]) }))}
              />
            </FilterButton>
            <SortButton
              value={sortValue(view.sort)}
              onChange={(next) => setView({ ...view, sort: SORTS.find((s) => s.value === next)!.sort })}
              options={SORTS.map((s) => ({ value: s.value, label: t(s.label) }))}
            />
            <SearchFold value={query} onChange={setQuery} placeholder={t('jobs.searchFor')} />
          </ListBar>
        )}

        <Card title={t(FILTER_LABEL[view.filter])} hueIndex={1}>
          {nothing ? (
            <Empty>{t('jobs.none')}</Empty>
          ) : shown.length === 0 && drafts.length === 0 ? (
            <Empty>{t('jobs.noMatch')}</Empty>
          ) : (
            <Rows className="-mx-2 flex flex-col">
              {shown.map((j) => (
                <JobRow
                  key={j.name}
                  job={j}
                  held={findings.find((f) => f.held && f.job === j.name)}
                  note={findings.find((f) => !f.held && f.job === j.name)}
                  conflict={conflicted.has(j.name)}
                  event={progress[j.name]}
                  busy={config.busy}
                  canPause={config.jobs?.some((raw) => raw.name === j.name) ?? false}
                  onPause={() => void config.setDisabled(j.name, !j.disabled)}
                />
              ))}
              {drafts.map(({ job, at }) => (
                <DraftRow key={`draft-${at}`} name={job.name || t('edit.unnamed')} onOpen={() => setEditing({ at, added: false })} />
              ))}
            </Rows>
          )}
        </Card>
      </div>

      {editing && config.jobs?.[editing.at] && (
        <JobEditor config={config} at={editing.at} added={editing.added} onClose={() => setEditing(null)} />
      )}

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

// A click on something inside the row that acts by itself must not open the row.
function keepInRow(e: MouseEvent) {
  e.stopPropagation()
}

/**
 * One job: the tile of its direction, its name with everything else it could
 * say in the bubble beside it, its two everyday buttons, its last runs and its
 * one status. The whole row opens the job's page. Below 600px the strip goes
 * and the status moves under the name, which would otherwise be cut to a few
 * letters beside the buttons.
 */
function JobRow({
  job,
  held,
  note,
  conflict,
  event,
  busy,
  canPause,
  onPause,
}: {
  job: Job
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
}) {
  const { t, lang } = useT()
  const push = useToast()
  const open = useOpenJob()
  const { drives } = usePlaces()
  const status = jobStatus(job, { held: !!held, conflict, notes: !!note })

  const facts = [
    t('jobs.fact.sides', {
      direction: t(directionKey[job.direction]),
      left: sideName(job.left, drives),
      right: sideName(job.right, drives),
    }),
    t('jobs.runs', { cadence: describeCadence(readCadence(job.schedule ?? '', !!job.watch), t) }),
    ...(job.nextRun && !job.disabled ? [t('jobs.fact.next', { when: dayTime(job.nextRun, lang, (p) => t('list.when', p)) })] : []),
  ]

  return (
    <li
      data-testid="job-row"
      data-new-way="/jobs/:name"
      onClick={() => open(job.name)}
      className="glim-row grid min-h-14 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto_auto_9rem] items-center gap-x-3 gap-y-0.5 rounded-control px-2 py-2 hover:bg-carbon-hover max-[600px]:grid-cols-[auto_minmax(0,1fr)_auto]"
    >
      <span className="glim-row-glyph flex h-9 w-9 shrink-0 items-center justify-center rounded-control max-[600px]:row-span-2 [&_svg]:h-4 [&_svg]:w-4">
        <DirectionGlyph direction={job.direction} />
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            keepInRow(e)
            open(job.name)
          }}
          className="min-w-0 truncate text-start text-body font-medium text-carbon-text hover:underline"
        >
          {job.name}
        </button>
        <span className="flex" onClick={keepInRow}>
          <InfoBubble tip={facts.join(' · ')} />
        </span>
      </span>
      {/* Holding and starting are separate controls: a held job can still be
          started by hand, and stays held. */}
      <span
        className="glim-row-actions flex shrink-0 items-center gap-1.5 max-[600px]:col-start-3 max-[600px]:row-span-2 max-[600px]:row-start-1"
        onClick={keepInRow}
      >
        {canPause && (
          <IconAction
            title={job.disabled ? t('jobs.resume') : t('jobs.pause')}
            labelKey={job.disabled ? 'jobs.resume' : 'jobs.pause'}
            disabled={busy}
            onClick={onPause}
          >
            {job.disabled ? <IconPlay /> : <IconPause />}
          </IconAction>
        )}
        <IconAction
          title={job.running ? t('jobs.cancelRun') : t('jobs.runNow')}
          labelKey={job.running ? 'jobs.cancelRun' : 'jobs.runNow'}
          hint={job.running ? undefined : t('jobs.runNowHint')}
          onClick={() => {
            const asked = job.running ? api.stopJob(job.name) : api.run(job.name)
            asked.catch((e: Error) => push(e.message, 'fail'))
          }}
        />
      </span>
      <span data-new="run-strip" className="shrink-0 max-[600px]:hidden">
        <RunStrip recent={job.recent} />
      </span>
      <span
        data-testid="job-status"
        className="flex justify-end max-[600px]:col-start-2 max-[600px]:row-start-2 max-[600px]:justify-start"
      >
        <JobStatusLine job={job} status={status} heldFinding={held?.id} noteFinding={note?.id} event={event} />
      </span>
    </li>
  )
}

/** A job the configuration holds but the engine does not run yet, which opens in the editor. */
function DraftRow({ name, onOpen }: { name: string; onOpen: () => void }) {
  const { t } = useT()
  return (
    <li className="glim-row flex min-h-14 cursor-pointer items-center gap-3 rounded-control px-2 py-2 hover:bg-carbon-hover" onClick={onOpen}>
      <span className="glim-row-glyph flex h-9 w-9 shrink-0 items-center justify-center rounded-control [&_svg]:h-4 [&_svg]:w-4">
        <DirectionGlyph direction="both" />
      </span>
      <button
        type="button"
        onClick={(e) => {
          keepInRow(e)
          onOpen()
        }}
        className="min-w-0 truncate text-start text-body font-medium text-carbon-text">
        {name}
      </button>
      <Badge tone="neutral">{t('edit.unsaved')}</Badge>
    </li>
  )
}
