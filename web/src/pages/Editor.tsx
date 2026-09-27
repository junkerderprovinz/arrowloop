import { Fragment, useCallback, useEffect, useState } from 'react'
import { jobCopy, uniqueName } from '../lib/jobCopy.data'

import { Field, Lines, Text } from '../components/Field'
import { ToggleRow } from '../components/ToggleRow'
import { api, type Direction, type Mode, type RawJob, type Settings } from '../lib/api'
import { DirectionSwitch } from '../components/Direction'
import { DEFAULT_QUIET } from '../components/QuietPeriod'
import { ExcludeSetPicker } from '../components/ExcludeSets'
import { FolderPicker, PickButton, type Known } from '../components/FolderPicker'
import { ScheduleField } from '../components/Schedule'
import { HUE_OFFSET, Selector } from '../components/Selector'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { followPatch, followsDefaults } from '../lib/follows'
import { MODES, modesHint } from '../lib/modes'
import { useT } from '../lib/i18n'

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
  // their exact spelling. A target is opened in the picker rather than taken
  // whole, so a folder on it can be chosen.
  useEffect(() => {
    const offers: Known[] = []
    void Promise.allSettled([api.volumes(), api.remotes()]).then(([v, r]) => {
      if (v.status === 'fulfilled') {
        for (const drive of v.value.volumes) {
          offers.push({ value: `${drive.path}/`, label: `${t('edit.pickDrive')}: ${drive.label}` })
        }
      }
      if (r.status === 'fulfilled') {
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

  /**
   * Writes a list to the file and takes back what the server made of it. It
   * takes the list as an argument, since a removal writes one that `jobs` does
   * not hold yet.
   */
  const persist = useCallback(
    async (list: RawJob[]) => {
      setBusy(true)
      setError(null)
      try {
        const result = await api.saveConfig(list)
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
    },
    [onSaved],
  )

  const save = useCallback(async () => {
    if (!jobs) return false
    return persist(jobs)
  }, [jobs, persist])

  /**
   * Adds a draft job and returns its index, so the caller can open it.
   *
   * The index comes from the current jobs rather than from inside a state
   * updater, which React runs later. A new job is enabled: with neither side
   * set the validator treats it as a draft, and it has no schedule yet. The
   * quiet period is seeded to DEFAULT_QUIET.
   */
  const add = useCallback((): number => {
    setSaved(false)
    const current = jobs ?? []
    // Two jobs with one name would be one job to every list, log and record.
    const name = uniqueName(t('edit.newJob'), current.map((j) => j.name ?? ''))
    const next: RawJob = {
      name,
      left: '',
      right: '',
      state: `state/${name}.db`,
      quietPeriod: DEFAULT_QUIET,
      exclude: [...DEFAULT_EXCLUDES],
    }
    setJobs([...current, next])
    return current.length
  }, [jobs, t])

  /**
   * Removes a job and writes the file straight away, since the removal was
   * already confirmed.
   *
   * `alsoState` deletes the job's state database first, while the job is still
   * in the configuration: the server resolves the path from the job's entry, so
   * nothing here can name a file outside it. A failure there is shown but does
   * not stop the removal, since the database is only a cache.
   */
  const remove = useCallback(
    async (at: number, alsoState: boolean) => {
      const current = jobs ?? []
      const job = current[at]
      if (!job) return
      setSaved(false)
      // A job with no name was never saved and has no state database.
      if (alsoState && job.name) {
        try {
          await api.forgetJobState(job.name)
        } catch (e) {
          setError((e as Error).message)
        }
      }
      await persist(current.filter((_, i) => i !== at))
    },
    [jobs, persist],
  )

  /**
   * Holds or releases a job's schedule and writes it straight away, unlike
   * `patch`, because it is pressed on a card with no form open and no save
   * button. A held job can still be started by hand.
   */
  const setDisabled = useCallback(
    async (at: number, disabled: boolean) => {
      const current = jobs ?? []
      const job = current[at]
      if (!job) return
      setSaved(false)
      await persist(current.map((j, i) => (i === at ? { ...j, disabled } : j)))
    },
    [jobs, persist],
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

  return { jobs, known, defaults, error, saved, busy, patch, save, add, remove, setDisabled, duplicate }
}

/** One job's fields, with the direction between the two sides it relates. */
export function JobForm({
  job,
  known,
  defaults,
  patch,
}: {
  job: RawJob
  known: Known[]
  /** The global sync settings, shown while the job follows them. */
  defaults?: Settings['defaults']
  patch: (next: Partial<RawJob>) => void
}) {
  const { t } = useT()
  const follows = followsDefaults(job)
  // While the job follows, the form shows what it runs with.
  const direction = (follows ? (defaults?.direction as Direction | undefined) : job.direction) ?? 'both'
  const schedule = (follows ? defaults?.schedule : job.schedule) ?? ''

  // The state path follows the name while it still has the generated
  // `state/<name>.db` form; a path somebody typed is left alone.
  function rename(next: string): Partial<RawJob> {
    const generated = (n: string) => `state/${n}.db`
    const current = job.state ?? ''
    if (current !== '' && current !== generated(job.name ?? '')) return { name: next }
    return { name: next, state: generated(next) }
  }

  return (
    <>
      {/* One grid for the name row and the sides row, so the name stands over
          the left side and the state file over the right, with the direction
          switch between them. A narrow card stacks all five. */}
      <div className="flex flex-col gap-4 @container">
        <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @2xl:gap-x-8">
          <Field label={t('edit.name')} hint={t('edit.nameHint')}>
            <Text value={job.name ?? ''} onChange={(v) => patch(rename(v))} />
          </Field>
          <div className="hidden @2xl:block" aria-hidden />
          <Field label={t('edit.state')} hint={t('edit.stateHint')}>
            <Text value={job.state ?? ''} onChange={(v) => patch({ state: v })} mono />
          </Field>

          <Side
            label={t('edit.left')}
            hint={t('edit.sideHint')}
            value={job.left ?? ''}
            known={known}
            onChange={(v) => patch({ left: v })}
          />
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-carbon-textMuted">
              {t('direction.label')}
              <InfoBubble tip={t('direction.hint')} />
            </span>
            {/* Raised by half of what it is taller than the boxes beside it, so
                it sits centred on them. */}
            <div className="@2xl:-mt-1">
              <DirectionSwitch
                direction={direction}
                disabled={follows}
                // Mirror and move need a source side. A two-way job says sync
                // rather than nothing, or it would take a default mirror.
                onChange={(v) => patch({ direction: v, mode: v === 'both' ? 'sync' : (job.mode ?? 'sync') })}
              />
            </div>
          </div>
          <Side
            label={t('edit.right')}
            hint={t('edit.sideHint')}
            value={job.right ?? ''}
            known={known}
            onChange={(v) => patch({ right: v })}
          />
        </div>

        <ToggleRow
          label={t('defaults.follow')}
          hint={t('defaults.followHint')}
          checked={follows}
          onChange={(on) => patch(followPatch(on, defaults))}
        />

        {/* The mode exists only once one side is the source. */}
        {!follows && direction !== 'both' && (
          <Field label={t('mode.label')} hint={modesHint(t)}>
            <Selector<Mode>
              scale="small"
              label={t('mode.label')}
              hueOffset={HUE_OFFSET.mode}
              value={job.mode ?? 'sync'}
              onChange={(v) => patch({ mode: v })}
              options={MODES.map((m) => ({ value: m, label: t(`mode.${m}`) }))}
            />
          </Field>
        )}

        <Field label={t('edit.schedule')} hint={t('edit.scheduleHint')}>
          <ScheduleField
            value={schedule}
            onChange={(v) => patch({ schedule: v })}
            live={!!job.watch}
            onLive={(v) => patch({ watch: v })}
            settle={job.watchSettle ?? ''}
            onSettle={(v) => patch({ watchSettle: v })}
            quiet={job.quietPeriod ?? ''}
            onQuiet={(v) => patch({ quietPeriod: v })}
            disabled={follows}
          />
        </Field>
      </div>

      <div className="mt-5">
        <Field label={t('edit.excludeSets')} hint={t('edit.excludeSetsHint')}>
          <ExcludeSetPicker
            chosen={job.excludeSets ?? []}
            onChange={(v) => patch({ excludeSets: v })}
          />
        </Field>
      </div>

      <div className="mt-5">
        <Field label={t('edit.exclude')} hint={t('edit.excludeHint')}>
          <Lines
            value={(job.exclude ?? []).join('\n')}
            onChange={(v) =>
              patch({
                exclude: v
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean),
              })
            }
            placeholder={'*.tmp\n**/node_modules/**'}
          />
        </Field>
      </div>

      {/* Shown and never edited: the server keeps what the file says, since
          a command set here would run with the rights of the process. */}
      {(job.before || job.after) && (
        <div className="mt-5">
          <Field label={t('edit.commands')} hint={t('edit.commandsHint')}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
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
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3">
        <ToggleRow
          label={t('edit.runAtStart')}
          checked={!!job.runAtStart}
          onChange={(v) => patch({ runAtStart: v })}
          hint={t('edit.runAtStartHint')}
        />
        {/* These two come from the global sync settings while the job
            follows them, so they are only offered once it does not. */}
        {!follows && (
          <>
            <ToggleRow
              label={t('edit.emptyDirs')}
              checked={!!job.emptyDirs}
              onChange={(v) => patch({ emptyDirs: v })}
              hint={t('edit.emptyDirsHint')}
            />
            <ToggleRow
              label={t('edit.metadata')}
              checked={!!job.metadata}
              onChange={(v) => patch({ metadata: v })}
              hint={t('edit.metadataHint')}
            />
          </>
        )}
        {/* Inverted from the stored `noTrash`, since a switch labelled with a
            negative gets flipped the wrong way, and here that deletes files. */}
        <ToggleRow
          label={t('edit.trash')}
          checked={!job.noTrash}
          onChange={(v) => patch({ noTrash: !v })}
          hint={t('edit.trashHint')}
        />
      </div>
    </>
  )
}

/**
 * One side of a job: a path field and a picker that walks this machine's
 * folders, the registered drives and the folders on every configured target.
 */
function Side({
  label,
  hint,
  value,
  known,
  onChange,
}: {
  label: string
  hint: string
  value: string
  known: Known[]
  onChange: (next: string) => void
}) {
  const [picking, setPicking] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <Field label={label} hint={hint}>
        <Text value={value} onChange={onChange} mono />
      </Field>
      {/* Under the box rather than beside it, so a long path keeps the whole
          width of its column. */}
      <div className="flex justify-end">
        <PickButton onClick={() => setPicking(true)} />
      </div>
      <FolderPicker
        open={picking}
        known={known}
        start={value}
        onClose={() => setPicking(false)}
        onPick={(path) => {
          onChange(path)
          setPicking(false)
        }}
      />
    </div>
  )
}
