import { useCallback, useEffect, useState } from 'react'
import { jobCopy, uniqueName } from '../lib/jobCopy.data'

import { Field, Lines, Text, Choice } from '../components/Field'
import { ToggleRow } from '../components/ToggleRow'
import { api, type RawJob } from '../lib/api'
import { DirectionSwitch } from '../components/Direction'
import { DEFAULT_QUIET, QuietPeriod } from '../components/QuietPeriod'
import { ExcludeSetPicker } from '../components/ExcludeSets'
import { FolderPicker, PickButton } from '../components/FolderPicker'
import { ScheduleField } from '../components/Schedule'
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
  const [known, setKnown] = useState<{ value: string; label: string }[]>([])

  useEffect(() => {
    api
      .config()
      .then((c) => setJobs(c.jobs))
      .catch((e: Error) => setError(e.message))
  }, [])

  // Registered drives and configured targets, offered so nobody has to retype
  // their exact spelling.
  useEffect(() => {
    const offers: { value: string; label: string }[] = []
    void Promise.allSettled([api.volumes(), api.remotes()]).then(([v, r]) => {
      if (v.status === 'fulfilled') {
        for (const drive of v.value.volumes) {
          offers.push({ value: `${drive.path}/`, label: `${t('edit.pickDrive')}: ${drive.label}` })
        }
      }
      if (r.status === 'fulfilled') {
        for (const remote of r.value.remotes) {
          offers.push({ value: `${remote.name}:`, label: `${t('edit.pickRemote')}: ${remote.name}` })
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
      setJobs([...current, copy])
      return current.length
    },
    [jobs, t],
  )

  return { jobs, known, error, saved, busy, patch, save, add, remove, setDisabled, duplicate }
}

/** One job's fields, with the direction between the two sides it relates. */
export function JobForm({
  job,
  known,
  patch,
}: {
  job: RawJob
  known: { value: string; label: string }[]
  patch: (next: Partial<RawJob>) => void
}) {
  const { t } = useT()

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
      {/* Rows use the same three parts as the two sides: field, a spacer as
          wide as the direction switch, field, so the columns line up. */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Field label={t('edit.name')} hint={t('edit.nameHint')}>
              <Text value={job.name ?? ''} onChange={(v) => patch(rename(v))} />
            </Field>
          </div>
          <div className="shrink-0 pt-[1.55rem]" aria-hidden>
            <div className="h-[var(--btn-h-key)] w-[var(--btn-h-key)]" />
          </div>
          <div className="min-w-0 flex-1">
            <Field label={t('edit.state')} hint={t('edit.stateHint')}>
              <Text value={job.state ?? ''} onChange={(v) => patch({ state: v })} mono />
            </Field>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Side
              label={t('edit.left')}
              hint={t('edit.sideHint')}
              value={job.left ?? ''}
              known={known}
              onChange={(v) => patch({ left: v })}
            />
          </div>
          {/* 1.3rem rather than the spacers' 1.55rem: the switch is a key
              control half a rem taller than the boxes, so this centres it
              against them. */}
          <div className="flex shrink-0 flex-col gap-1.5 pt-[1.3rem]">
            <DirectionSwitch
              direction={job.direction ?? 'both'}
              // Mirror and move need a source side, and the engine refuses a
              // two-way job that still stores one.
              onChange={(v) => patch({ direction: v, mode: v === 'both' ? undefined : job.mode })}
              hint={t('direction.hint')}
            />
          </div>
          <div className="min-w-0 flex-1">
            <Side
              label={t('edit.right')}
              hint={t('edit.sideHint')}
              value={job.right ?? ''}
              known={known}
              onChange={(v) => patch({ right: v })}
            />
          </div>
        </div>

        {/* The mode exists only once one side is the source. Two of the three
            modes delete, so the bubble explains the one currently chosen. */}
        {(job.direction ?? 'both') !== 'both' && (
          <Field
            label={t('mode.label')}
            hint={
              job.mode === 'mirror'
                ? t('mode.mirrorHint')
                : job.mode === 'move'
                  ? t('mode.moveHint')
                  : t('mode.syncHint')
            }
          >
            <Choice
              value={job.mode ?? 'sync'}
              onChange={(v) => patch({ mode: v })}
              options={[
                { value: 'sync', label: t('mode.sync') },
                { value: 'mirror', label: t('mode.mirror') },
                { value: 'move', label: t('mode.move') },
              ]}
            />
          </Field>
        )}

        {/* The quiet period sits beside the schedule, since both answer when
            the job runs. */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Field label={t('edit.schedule')} hint={t('edit.scheduleHint')}>
              <ScheduleField
                value={job.schedule ?? ''}
                onChange={(v) => patch({ schedule: v })}
                live={!!job.watch}
                onLive={(v) => patch({ watch: v })}
                settle={job.watchSettle ?? ''}
                onSettle={(v) => patch({ watchSettle: v })}
              />
            </Field>
          </div>
          <div className="shrink-0 pt-[1.55rem]" aria-hidden>
            <div className="h-[var(--btn-h-key)] w-[var(--btn-h-key)]" />
          </div>
          <div className="min-w-0 flex-1">
            <Field label={t('edit.quietPeriod')} hint={t('edit.quietHint')}>
              <QuietPeriod
                value={job.quietPeriod ?? ''}
                onChange={(v) => patch({ quietPeriod: v })}
              />
            </Field>
          </div>
        </div>
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

      <div className="mt-5 flex flex-col gap-3">
        <ToggleRow
          label={t('edit.runAtStart')}
          checked={!!job.runAtStart}
          onChange={(v) => patch({ runAtStart: v })}
          hint={t('edit.runAtStartHint')}
        />
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
 * One side of a job: a path field and a folder picker, which also offers the
 * registered drives and targets.
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
  known: { value: string; label: string }[]
  onChange: (next: string) => void
}) {
  const [picking, setPicking] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <Field label={label} hint={hint}>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Text value={value} onChange={onChange} mono />
          </div>
          <PickButton onClick={() => setPicking(true)} />
        </div>
      </Field>
      <FolderPicker
        open={picking}
        known={known}
        // A value with a colon is a target's name rather than a local folder
        // (a Windows drive letter aside), so browsing starts at the top.
        start={value.includes(':') && !/^[A-Za-z]:[\\/]/.test(value) ? undefined : value}
        onClose={() => setPicking(false)}
        onPick={(path) => {
          onChange(path)
          setPicking(false)
        }}
      />
    </div>
  )
}
