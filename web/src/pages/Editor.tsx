import { Fragment, useCallback, useEffect, useState } from 'react'
import { jobCopy, uniqueName } from '../lib/jobCopy.data'

import { Field, FieldRow, Lines, Text } from '../components/Field'
import { api, type Direction, type Mode, type RawJob, type Remote, type Settings } from '../lib/api'
import { Held, SettingRow } from '../components/GlobalValues'
import { JobWay } from '../components/JobWay'
import { QuietPeriod } from '../components/QuietPeriod'
import { ExcludeSetPicker } from '../components/ExcludeSets'
import type { Known } from '../components/FolderPicker'
import { ScheduleDetails, ScheduleKinds, useSchedule } from '../components/Schedule'
import { HUE_OFFSET, Selector } from '../components/Selector'
import { Toggle } from '../lib/glimstone/Toggle'
import { JOB_WINDOW_SETTINGS, overrideAll, owns } from '../lib/follows'
import { MODES } from '../lib/modes'
import { errorText } from '../lib/errorText'
import { useT } from '../lib/i18n'
import { SubCard } from './settings/rows'

/**
 * What a new job starts out ignoring: files the operating system or a tool
 * rewrites on its own, which would only produce noise and conflicts.
 */
export const DEFAULT_EXCLUDES = [
  // Half-written by definition.
  '*.tmp',
  '*.temp',
  '*.part',
  '*.crdownload',
  '~$*',
  // Written by file managers merely looking at a folder.
  'Thumbs.db',
  'desktop.ini',
  '.DS_Store',
  '._*',
  // Whole trees the system owns and rewrites without being asked.
  '**/$RECYCLE.BIN/**',
  '**/System Volume Information/**',
  '**/.Trash-*/**',
  '**/@eaDir/**',
  '**/lost+found/**',
  // Caches that regenerate. Copying them is slower than rebuilding them.
  '**/node_modules/**',
  '**/.git/**',
]

/**
 * The job list shared by the list and the form on the Jobs tab, and every edit
 * to it. It writes the configuration file through the same validator a
 * hand-edited file meets.
 */
export function useJobConfig(onSaved: () => void) {
  const { t } = useT()
  const [jobs, setJobs] = useState<RawJob[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [known, setKnown] = useState<Known[]>([])
  const [remotes, setRemotes] = useState<Remote[]>([])
  const [defaults, setDefaults] = useState<Settings['defaults']>(undefined)

  useEffect(() => {
    api
      .config()
      .then((c) => setJobs(c.jobs))
      .catch((e: Error) => setError(e.message))
    // What a job that follows the global sync settings runs with. Without it
    // the form shows the engine's own defaults, which is what then applies.
    api
      .settings()
      .then((got) => setDefaults(got.defaults))
      .catch(() => setDefaults(undefined))
  }, [])

  // Registered drives and configured targets, offered so nobody has to retype
  // their exact spelling. Both open in the picker rather than being taken
  // whole, so a folder on them can be chosen; a drive that is not plugged in
  // cannot be opened and is taken whole.
  useEffect(() => {
    const offers: Known[] = []
    void Promise.allSettled([api.volumes(), api.remotes()]).then(([v, r]) => {
      if (v.status === 'fulfilled') {
        for (const drive of v.value.volumes) {
          offers.push({ value: `${drive.path}/`, label: `${t('edit.pickDrive')}: ${drive.label}`, browse: drive.attached })
        }
      }
      if (r.status === 'fulfilled') {
        setRemotes(r.value.remotes)
        for (const remote of r.value.remotes) {
          offers.push({ value: `${remote.name}:`, label: `${t('edit.pickRemote')}: ${remote.name}`, browse: true })
        }
      }
      setKnown(offers)
    })
  }, [t])

  const patch = useCallback((at: number, next: Partial<RawJob>) => {
    setSaved(false)
    setJobs((prev) => prev && prev.map((j, i) => (i === at ? { ...j, ...next } : j)))
  }, [])

  /** Puts an entry back as it was, for an edit that was cancelled. */
  const replace = useCallback((at: number, job: RawJob) => {
    setJobs((prev) => prev && prev.map((j, i) => (i === at ? job : j)))
  }, [])

  /** Writes this tab's whole list and takes back what the server made of it. */
  const save = useCallback(async () => {
    if (!jobs) return false
    setBusy(true)
    setError(null)
    try {
      const result = await api.saveConfig(jobs)
      setJobs(result.jobs)
      setSaved(true)
      onSaved()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }, [jobs, onSaved])

  /**
   * Changes one saved job in the file as it stands now, read again first, so
   * neither the unsaved edits on other cards nor a change made in another
   * window since this page loaded go with it.
   */
  const writeOne = useCallback(
    async (change: (file: RawJob[]) => RawJob[]) => {
      setBusy(true)
      setError(null)
      try {
        const { jobs: file } = await api.config()
        await api.saveConfig(change(file))
        setSaved(true)
        onSaved()
        return true
      } catch (e) {
        setError((e as Error).message)
        return false
      } finally {
        setBusy(false)
      }
    },
    [onSaved],
  )

  /**
   * Adds a draft job and returns its index, so the caller can open it, or null
   * while the job list has not loaded: a save would write the draft alone over
   * every job in the file.
   *
   * The index comes from the current jobs rather than from inside a state
   * updater, which React runs later. A new job is enabled: with neither side
   * set the validator treats it as a draft. It follows the global sync
   * settings until one of them is overridden.
   */
  const add = useCallback((): number | null => {
    if (!jobs) return null
    setSaved(false)
    // Two jobs with one name would be one job to every list, log and record.
    const name = uniqueName(t('edit.newJob'), jobs.map((j) => j.name ?? ''))
    const next: RawJob = {
      name,
      left: '',
      right: '',
      state: `state/${name}.db`,
      exclude: [...DEFAULT_EXCLUDES],
    }
    setJobs([...jobs, next])
    return jobs.length
  }, [jobs, t])

  /**
   * Removes the entry at `at` from this tab's list. A saved job, named by
   * `saved`, also leaves the file straight away, since the removal was already
   * confirmed; a draft only ever lived here.
   *
   * `alsoState` deletes the job's state database first, while the job is still
   * in the configuration: the server resolves the path from the job's entry, so
   * nothing here can name a file outside it. A failure there is shown but does
   * not stop the removal, since the database is only a cache.
   *
   * `gone` runs in the same render as the shorter list, for state that points
   * into it by position.
   */
  const remove = useCallback(
    async (at: number, alsoState: boolean, saved?: string, gone?: () => void) => {
      setSaved(false)
      if (saved !== undefined) {
        if (alsoState) {
          try {
            await api.forgetJobState(saved)
          } catch (e) {
            setError(errorText(t, e))
          }
        }
        if (!(await writeOne((file) => file.filter((j) => j.name !== saved)))) return
      }
      setJobs((prev) => prev && prev.filter((_, i) => i !== at))
      gone?.()
    },
    [writeOne],
  )

  /**
   * Holds or releases a saved job's schedule and writes it straight away,
   * unlike `patch`, because it is pressed on a card with no form open and no
   * save button. A held job can still be started by hand.
   */
  const setDisabled = useCallback(
    async (name: string, disabled: boolean) => {
      setSaved(false)
      const hold = (list: RawJob[]) => list.map((j) => (j.name === name ? { ...j, disabled } : j))
      if (await writeOne(hold)) setJobs((prev) => prev && hold(prev))
    },
    [writeOne],
  )

  /**
   * Changes fields of a saved job that are set outside its form, such as its
   * brakes, and writes them straight away the way setDisabled does, so a later
   * save of the form keeps them.
   */
  const amend = useCallback(
    async (name: string, change: (job: RawJob) => RawJob) => {
      setSaved(false)
      const apply = (list: RawJob[]) => list.map((j) => (j.name === name ? change(j) : j))
      if (await writeOne(apply)) setJobs((prev) => prev && apply(prev))
    },
    [writeOne],
  )

  /**
   * Copies a job as a draft in the form, not yet written, and returns its
   * index. The copy's name, own state database and held state come from
   * jobCopy, shared with the phone.
   */
  const duplicate = useCallback(
    (at: number): number => {
      setSaved(false)
      const current = jobs ?? []
      const source = current[at]
      if (!source) return at
      const copy = jobCopy<RawJob>(
        source,
        current.map((j) => j.name ?? ''),
        t('edit.copySuffix'),
        t('edit.newJob'),
      )
      // The server gives a job under a new name no commands, so the draft
      // should not show any either.
      delete copy.before
      delete copy.after
      setJobs([...current, copy])
      return current.length
    },
    [jobs, t],
  )

  return { jobs, known, remotes, defaults, error, saved, busy, patch, replace, save, add, remove, setDisabled, amend, duplicate }
}

/** The state file's box, wide enough to read a path beside its name. */
const PATH_W = 'w-[31rem]'

/**
 * One job's fields: the way it runs on top, then what it does in three cards.
 * While it takes the global settings, every field that has a global value
 * shows that value, held, and reaching for one calls `onHeld`.
 */
export function JobForm({
  job,
  known,
  remotes,
  defaults,
  patch,
  follows,
  onHeld,
}: {
  job: RawJob
  known: Known[]
  remotes: Remote[]
  /** The global sync settings, whose values the job shows while it follows them. */
  defaults?: Settings['defaults']
  patch: (next: Partial<RawJob>) => void
  follows: boolean
  onHeld: () => void
}) {
  const { t } = useT()
  const [advanced, setAdvanced] = useState(false)
  // What the job runs with. A job written by hand can hold some settings and
  // leave others to the defaults, and those show the default's value too.
  const unset = JOB_WINDOW_SETTINGS.filter((s) => !owns(job, s))
  const shown: RawJob = { ...job, ...(overrideAll(defaults, unset) as RawJob) }
  const direction: Direction = shown.direction ?? 'both'
  const held = { held: follows, onHeld }
  const schedule = useSchedule({
    value: shown.schedule ?? '',
    watch: !!shown.watch,
    settle: shown.watchSettle ?? '',
    realTime: true,
    onChange: patch,
  })

  // The state path follows the name while it still has the generated
  // `state/<name>.db` form; a path somebody typed is left alone.
  function rename(next: string): Partial<RawJob> {
    const generated = (n: string) => `state/${n}.db`
    const current = job.state ?? ''
    if (current !== '' && current !== generated(job.name ?? '')) return { name: next }
    return { name: next, state: generated(next) }
  }

  return (
    <div className="flex flex-col gap-4 pb-2">
      <FieldRow label={t('edit.name')}>
        <Text value={job.name ?? ''} onChange={(v) => patch(rename(v))} label={t('edit.name')} />
      </FieldRow>

      <JobWay
        left={job.left ?? ''}
        right={job.right ?? ''}
        direction={direction}
        onLeft={(v) => patch({ left: v })}
        onRight={(v) => patch({ right: v })}
        // Mirror and move need a source side. A two-way job says sync
        // rather than nothing, or it would take a default mirror.
        onDirection={(v) => patch({ direction: v, mode: v === 'both' ? 'sync' : (job.mode ?? 'sync') })}
        known={known}
        remotes={remotes}
        {...held}
      />

      <SubCard label={t('edit.schedule')}>
        <Held block {...held}>
          <div data-new="schedule-hs">
            <ScheduleKinds editor={schedule} />
          </div>
          <ScheduleDetails editor={schedule} />
        </Held>
        {/* Zero is written as 0s, since an empty quiet period is one the job
            leaves to the defaults. */}
        <SettingRow label={t('edit.quietPeriod')} hint={t('edit.quietHint')} {...held}>
          <QuietPeriod value={shown.quietPeriod ?? ''} onChange={(v) => patch({ quietPeriod: v || '0s' })} />
        </SettingRow>
        <SettingRow label={t('edit.runAtStart')}>
          <Toggle checked={!!job.runAtStart} onChange={(v) => patch({ runAtStart: v })} label={t('edit.runAtStart')} hideLabel />
        </SettingRow>
      </SubCard>

      <SubCard label={t('edit.matching')}>
        {/* The mode exists only once one side is the source, and a newer
            version can only win where both sides change. */}
        {direction !== 'both' && (
          <Held block {...held}>
            <div data-new="mode-hs">
              <Selector<Mode>
                low
                label={t('mode.label')}
                hueOffset={HUE_OFFSET.mode}
                value={shown.mode ?? 'sync'}
                onChange={(v) => patch({ mode: v })}
                options={MODES.map((m) => ({ value: m, label: t(`mode.${m}`), hint: t(`mode.${m}Hint`) }))}
              />
            </div>
          </Held>
        )}
        {direction === 'both' && (
          <div data-new="newer-wins">
            <SettingRow label={t('edit.newerWins')} hint={t('edit.newerWinsHint')}>
              <Toggle checked={!!job.newerWins} onChange={(v) => patch({ newerWins: v })} label={t('edit.newerWins')} hideLabel />
            </SettingRow>
          </div>
        )}
        <SettingRow label={t('edit.emptyDirs')} {...held}>
          <Toggle checked={!!shown.emptyDirs} onChange={(v) => patch({ emptyDirs: v })} label={t('edit.emptyDirs')} hideLabel />
        </SettingRow>
        <SettingRow label={t('edit.metadata')} hint={t('edit.metadataHint')} {...held}>
          <Toggle checked={!!shown.metadata} onChange={(v) => patch({ metadata: v })} label={t('edit.metadata')} hideLabel />
        </SettingRow>
        {/* Inverted from the stored `noTrash`, since a switch labelled with a
            negative gets flipped the wrong way, and here that deletes files. */}
        <SettingRow label={t('edit.trash')} hint={t('edit.trashHint')}>
          <Toggle checked={!job.noTrash} onChange={(v) => patch({ noTrash: !v })} label={t('edit.trash')} hideLabel />
        </SettingRow>
      </SubCard>

      <SubCard label={t('edit.exclude')}>
        <Field label={t('edit.excludeSets')} hint={t('edit.excludeSetsHint')}>
          <ExcludeSetPicker chosen={job.excludeSets ?? []} onChange={(v) => patch({ excludeSets: v })} />
        </Field>
        <Field label={t('edit.ownExclude')} hint={t('edit.excludeHint')}>
          <Lines value={job.exclude ?? []} onChange={(v) => patch({ exclude: v })} placeholder={'*.tmp\n**/node_modules/**'} />
        </Field>
      </SubCard>

      <section className="flex flex-col gap-4">
        <button
          type="button"
          aria-expanded={advanced}
          onClick={() => setAdvanced((was) => !was)}
          className="glim-eyebrow flex items-center gap-1.5 self-start font-semibold outline-none transition hover:text-carbon-text focus-visible:text-carbon-text"
        >
          <svg
            aria-hidden
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className={`transition-transform ${advanced ? '' : '-rotate-90 rtl:rotate-90'}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M2 4l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t('edit.advanced')}
        </button>
        {advanced && (
          <>
            <FieldRow label={t('edit.state')} hint={t('edit.stateHint')} width={PATH_W}>
              <Text value={job.state ?? ''} onChange={(v) => patch({ state: v })} label={t('edit.state')} mono />
            </FieldRow>
            {/* Shown and never edited: the server keeps what the file says,
                since a command set here would run with the rights of the
                process. */}
            {(job.before || job.after) && (
              <Field label={t('edit.commands')} hint={t('edit.commandsHint')} plain>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-body">
                  {(
                    [
                      ['edit.before', job.before],
                      ['edit.after', job.after],
                    ] as const
                  )
                    .filter(([, command]) => command)
                    .map(([key, command]) => (
                      <Fragment key={key}>
                        <dt className="text-carbon-textMuted">{t(key)}</dt>
                        <dd className="min-w-0 break-all font-mono">{command}</dd>
                      </Fragment>
                    ))}
                </dl>
              </Field>
            )}
          </>
        )}
      </section>
    </div>
  )
}
