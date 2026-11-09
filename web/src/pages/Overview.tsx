import { useState, type CSSProperties, type MouseEvent } from 'react'

import { IconAction } from '../components/IconAction'
import { IconAdd, IconClose, IconPlay, IconStop } from '../components/glyphs'
import { JobEditor, useConfigErrors } from '../components/JobEditor'
import { JobStatusLine } from '../components/JobStatusLine'
import { LogoMark } from '../components/LogoMark'
import { OtherInstances } from '../components/OtherInstances'
import { PageAction, PageActions } from '../components/PageActions'
import { RecentRun } from '../components/RecentRun'
import { Empty, Stack } from '../components/Shell'
import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { useJobConfig } from './Editor'
import type { Finding } from '../lib/anomalies'
import { api, type Job, type OpenConflict, type Run, type RunEvent } from '../lib/api'
import { hueVars } from '../lib/appearance'
import { dayTime } from '../lib/dayTime'
import { openExternal } from '../lib/external'
import { useT, type TranslationKey } from '../lib/i18n'
import { useNarrow } from '../lib/narrow'
import { jobStatus } from '../lib/jobList'
import type { NavCounts } from '../lib/navModel'
import { useOpenJob } from '../lib/openJob'
import { failing, headOf, lastAndNext, type Headline } from '../lib/overviewHead'
import { useReleaseNotice, type ReleaseNotice } from '../lib/releaseNotice'
import { Link, navigate } from '../lib/router'
import { useStartStop } from '../lib/startStop'
import { useToast } from '../lib/toast'

/** How many of the latest runs the Overview lists. History holds the rest. */
const RECENT = 5

const HEADLINE: Record<Exclude<Headline, 'needs'>, TranslationKey> = {
  empty: 'overview.head.empty',
  running: 'overview.running',
  notes: 'overview.head.notes',
  allGood: 'overview.head.allGood',
}

const MARK: Record<Headline, string> = {
  empty: 'text-carbon-textMuted',
  needs: 'text-statusWarn',
  running: 'text-accentGlyph',
  notes: 'text-statusOk',
  allGood: 'text-statusOk',
}

/**
 * How the whole install stands at a glance: one sentence about it, the counts
 * of what runs and what waits, each leading to its page, the jobs in their own
 * order with their last and next run, the latest runs and the jobs of the
 * paired instances. The counts come from the shell, the same ones the rail
 * shows, so the two never disagree.
 */
export function Overview({
  jobs,
  runs,
  findings,
  conflicts = [],
  counts,
  anomalies,
  progress,
  onSaved,
}: {
  jobs: Job[]
  /** The latest runs across every job, newest first. */
  runs: Run[]
  /** The open findings, which decide a held job's status. */
  findings: Finding[]
  conflicts?: Pick<OpenConflict, 'job'>[]
  counts: NavCounts
  /** Whether the anomaly notes are switched on. */
  anomalies: boolean
  progress: Record<string, RunEvent>
  onSaved: () => void
}) {
  const { t } = useT()
  const push = useToast()
  const config = useJobConfig(onSaved)
  useConfigErrors(config)
  const [adding, setAdding] = useState<number | null>(null)
  const [release, hideRelease] = useReleaseNotice()
  // The cards count their rainbow from the first one shown.
  const hue = release ? 1 : 0

  const empty = jobs.length === 0
  const held = findings.filter((f) => f.held)
  const head = headOf({
    jobs,
    conflicts: counts.conflicts,
    held: anomalies ? held.length : 0,
    notes: anomalies ? findings.length - held.length : 0,
  })
  const running = jobs.filter((j) => j.running)
  // Paused jobs and drafts stay out of "run all", as they would on a schedule.
  const ready = jobs.filter((j) => !j.disabled && !j.running && j.left && j.right)

  function add() {
    const at = config.add()
    if (at !== null) setAdding(at)
  }

  // Each job is asked on its own, so one refusal leaves the others going.
  function everyJob(names: string[], act: (name: string) => Promise<unknown>) {
    void Promise.allSettled(names.map((name) => act(name))).then((answers) => {
      onSaved()
      const refused = answers.find((a): a is PromiseRejectedResult => a.status === 'rejected')
      if (refused) push((refused.reason as Error).message, 'fail')
    })
  }

  return (
    <Stack>
      <Head headline={head.headline} needs={head.needs} jobs={jobs} />

      {release && <ReleaseCard release={release} onHide={() => hideRelease(release.tag)} />}

      {!empty && (
        <Card title={t('overview.numbers')} hint={t('overview.numbersHint')} hueIndex={hue}>
          {/* The tiles go by the card's width rather than the window's, which the
              sidebar takes its part of, and a short last row stretches too, so
              they always fill the card. */}
          <div className="@container">
            <div data-testid="overview-tiles" className="flex flex-wrap gap-3">
              <Tile to="/jobs" label={t('status.running')} value={counts.running} tone={counts.running > 0 ? 'run' : undefined} />
              <Tile to="/jobs" label={t('status.paused')} value={jobs.filter((j) => j.disabled).length} />
              <Tile to="/jobs" label={t('status.failed')} value={jobs.filter(failing).length} tone="fail" />
              <Tile to="/conflicts" label={t('nav.conflicts')} value={counts.conflicts} tone="warn" />
              {anomalies && <Tile to="/anomalies" label={t('nav.anomalies')} value={counts.findings} tone={held.length > 0 ? 'warn' : undefined} />}
              <Tile to="/trash" label={t('nav.trash')} value={counts.trash} />
            </div>
          </div>
        </Card>
      )}

      {empty ? (
        <Card title={t('nav.jobs')} hueIndex={hue}>
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <p className="max-w-prose text-body text-carbon-textSub">{t('phone.noJobs')}</p>
            <Button label={t('edit.add')} labelKey="edit.add" glyph={<IconAdd />} tone="accent" disabled={!config.jobs} onClick={add} />
          </div>
        </Card>
      ) : (
        // Side by side where there is room, the jobs taking the larger part.
        <div className="grid grid-cols-1 items-start gap-10 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:gap-6">
          <Card title={t('nav.jobs')} hint={t('overview.jobsHint')} hueIndex={hue + 1}>
            <ul className="-mx-2 flex flex-col">
              {jobs.map((job, i) => (
                <JobLine
                  key={job.name}
                  job={job}
                  hueIndex={i}
                  held={findings.find((f) => f.held && f.job === job.name)}
                  note={findings.find((f) => !f.held && f.job === job.name)}
                  conflict={conflicts.some((c) => c.job === job.name)}
                  event={progress[job.name]}
                  onAnswered={onSaved}
                />
              ))}
            </ul>
          </Card>

          <Card title={t('activity.recent')} hueIndex={hue + 2}>
            {runs.length === 0 ? (
              <Empty>{t('history.empty')}</Empty>
            ) : (
              <div className="flex flex-col gap-4">
                <ul className="flex flex-col gap-3">
                  {runs.slice(0, RECENT).map((r) => (
                    <RecentRun key={r.ID} run={r} />
                  ))}
                </ul>
                <div className="flex justify-end">
                  <Button label={t('history.showAll')} labelKey="history.showAll" onClick={() => navigate('/history')} />
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      <OtherInstances firstHue={hue + 3} />

      {adding !== null && config.jobs?.[adding] && (
        <JobEditor config={config} at={adding} added onClose={() => setAdding(null)} />
      )}

      <PageActions>
        {empty ? (
          <PageAction primary label={t('edit.add')} labelKey="edit.add" glyph={<IconAdd />} disabled={!config.jobs} onClick={add} />
        ) : running.length > 0 ? (
          <PageAction
            label={t('jobs.stopAll')}
            labelKey="jobs.stopAll"
            glyph={<IconStop />}
            onClick={() => everyJob(running.map((j) => j.name), api.stopJob)}
          />
        ) : (
          <PageAction
            primary
            label={t('jobs.runAll')}
            labelKey="jobs.runAll"
            glyph={<IconPlay />}
            disabled={ready.length === 0}
            onClick={() => everyJob(ready.map((j) => j.name), api.run)}
          />
        )}
      </PageActions>
    </Stack>
  )
}

/**
 * The page's opening sentence beside the app's mark in the colour of how
 * things stand, and under it when the last run ended and the next one starts.
 * The mark turns while anything runs, as a running job's mark does.
 */
function Head({ headline, needs, jobs }: { headline: Headline; needs: number; jobs: Job[] }) {
  const { t, lang } = useT()
  const { last, next } = lastAndNext(jobs)
  const when = (at: string) => dayTime(at, lang, (p) => t('list.when', p))
  const line = [last && t('jobs.lastRun', { when: when(last) }), next && t('jobs.fact.next', { when: when(next) })].filter(Boolean).join(' · ')
  return (
    <div data-testid="overview-head" data-new="overview" className="flex items-center gap-4 pt-2 md:gap-5">
      <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-carbon-surface ${MARK[headline]}`}>
        <LogoMark size={36} className={headline === 'running' ? 'al-turning shrink-0' : 'shrink-0'} />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="text-status font-semibold leading-tight text-carbon-text">
          {headline === 'needs' ? t('overview.head.needs', { count: needs }) : t(HEADLINE[headline])}
        </h1>
        {line && <p className="glim-num mt-1 text-subline text-carbon-textSub">{line}</p>}
      </div>
    </div>
  )
}

/** A newer release, and how a container that cannot replace itself gets it. */
function ReleaseCard({ release, onHide }: { release: ReleaseNotice; onHide: () => void }) {
  const { t } = useT()
  return (
    <Card title={t('overview.release.title')} hueIndex={0}>
      <div data-testid="release-notice" className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="h-6 w-1.5 shrink-0 rounded-[var(--radius-pill)] bg-statusWarnSolid" />
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-body font-medium text-carbon-text">{t('overview.release.out', { version: release.version })}</p>
          <p className="mt-0.5 text-subline text-carbon-textSub">{t('overview.release.how')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button label={t('about.releaseNotes')} labelKey="about.releaseNotes" onClick={() => openExternal(release.notes)} />
          <Button label={t('overview.release.dismiss')} labelKey="overview.release.dismiss" glyph={<IconClose />} onClick={onHide} />
        </div>
      </div>
    </Card>
  )
}

const TONE = {
  run: 'text-accentGlyph',
  warn: 'text-statusWarn',
  fail: 'text-statusFail',
} as const

/** A count that leads to the page listing what it counts. Its colour only shows while there is something to count. */
function Tile({ to, label, value, tone }: { to: string; label: string; value: number; tone?: keyof typeof TONE }) {
  const { lang } = useT()
  return (
    <Link
      to={to}
      className="glim-row flex min-w-0 grow basis-[calc((100%-0.75rem)/2)] flex-col gap-1 rounded-control bg-carbon-surface2 px-4 py-3 @lg:basis-[calc((100%-1.5rem)/3)] @4xl:basis-0 transition-colors hover:bg-carbon-surface3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring)"
    >
      <span className={`glim-num text-status font-bold leading-tight ${tone && value > 0 ? TONE[tone] : 'text-carbon-text'}`}>
        {new Intl.NumberFormat(lang).format(value)}
      </span>
      <span className="text-subline leading-tight text-carbon-textSub [overflow-wrap:anywhere]">{label}</span>
    </Link>
  )
}

// A click on something inside the line that acts by itself must not open the job.
function keepInLine(e: MouseEvent) {
  e.stopPropagation()
}

/**
 * One job on one line, as the compact job list draws it: its colour, its name,
 * its status, when it ran last and runs next, and Run now. A click anywhere else
 * opens the job.
 */
function JobLine({
  job,
  hueIndex,
  held,
  note,
  conflict,
  event,
  onAnswered,
}: {
  job: Job
  hueIndex: number
  held?: Finding
  note?: Finding
  conflict: boolean
  event?: RunEvent
  onAnswered: () => void
}) {
  const { t, lang } = useT()
  const open = useOpenJob()
  const narrow = useNarrow()
  const status = jobStatus(job, { held: !!held, conflict, notes: !!note })
  const startStop = useStartStop(job, onAnswered)
  const when = (at: string) => dayTime(at, lang, (p) => t('list.when', p))
  // The status of a job that ran fine is already the time of that run.
  const last = status !== 'last' && job.recent[0]
  const next = job.nextRun && !job.disabled ? job.nextRun : ''
  return (
    <li
      data-job={job.name}
      onClick={() => open(job.name)}
      style={hueVars(hueIndex) as CSSProperties}
      className="glim-hue glim-row flex cursor-pointer items-center gap-3 rounded-control px-2 py-2 hover:bg-carbon-hover"
    >
      <span aria-hidden className="h-6 w-1.5 shrink-0 rounded-[var(--radius-pill)] bg-accent" />
      {/* On a phone the status goes under the name, so the name keeps its room. */}
      <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="flex min-w-0 flex-col gap-0.5 sm:flex-1">
          <Link
            to={`/jobs/${encodeURIComponent(job.name)}`}
            onClick={keepInLine}
            className="min-w-0 truncate text-body font-medium text-carbon-text hover:underline"
          >
            {job.name}
          </Link>
          {(last || next) && (
            <span className="glim-num flex flex-wrap gap-x-3 text-subline text-carbon-textSub">
              {last && <span>{t('jobs.lastRun', { when: when(last.Finished) })}</span>}
              {next && <span>{t('jobs.fact.next', { when: when(next) })}</span>}
            </span>
          )}
        </span>
        <span data-testid="job-status" className="flex shrink-0 sm:justify-end">
          <JobStatusLine job={job} status={status} heldFinding={held?.id} noteFinding={note?.id} event={event} />
        </span>
      </span>
      <span className="flex shrink-0" onClick={keepInLine}>
        <IconAction
          title={startStop.label}
          labelKey={startStop.labelKey}
          hint={startStop.hint}
          disabled={startStop.disabled}
          className={narrow ? 'glim-glyph-only' : ''}
          onClick={startStop.press}
        />
      </span>
    </li>
  )
}
