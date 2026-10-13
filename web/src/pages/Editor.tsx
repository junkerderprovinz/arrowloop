import { Fragment, useCallback, useEffect, useState } from 'react'
import { jobCopy, uniqueName } from '../lib/jobCopy.data'

import { Field, FieldRow, Lines, Text } from '../components/Field'
import { ToggleRow } from '../components/ToggleRow'
import { api, type Direction, type Mode, type RawJob, type Settings } from '../lib/api'
import { DirectionSwitch } from '../components/Direction'
import { InheritButton, InheritedRow } from '../components/Inherited'
import { QuietPeriod } from '../components/QuietPeriod'
import { ExcludeSetPicker } from '../components/ExcludeSets'
import { FolderPicker, PickButton, type Known } from '../components/FolderPicker'
import { ScheduleField } from '../components/Schedule'
import { ScheduleButton } from '../components/ScheduleButton'
import { HUE_OFFSET, Selector } from '../components/Selector'
import { Toggle } from '../lib/glimstone/Toggle'
import { inForce, inheritPatch, owns, type Inherited } from '../lib/follows'
import { MODES } from '../lib/modes'
import { errorText } from '../lib/errorText'
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

  return { jobs, known, defaults, error, saved, busy, patch, replace, save, add, remove, setDisabled, amend, duplicate }
}

/** A path's box with its browse button, wide enough to read a path beside its name. */
const PATH_W = 'w-[31rem]'

/** One job's fields, with the direction between the two sides it relates. */
export function JobForm({
  job,
  known,
  defaults,
  patch,
}: {
  job: RawJob
  known: Known[]
  /** The global sync settings, whose values the job shows until it overrides them. */
  defaults?: Settings['defaults']
  patch: (next: Partial<RawJob>) => void
}) {
  const { t } = useT()
  const own = (setting: Inherited) => owns(job, setting)
  // What the job runs with: its own value, or the default's while it follows.
  const shown = (setting: Inherited): RawJob => (own(setting) ? job : { ...job, ...(inForce(defaults, setting) as RawJob) })
  const action = (setting: Inherited) => (
    <InheritButton
      setting={setting}
      own={own(setting)}
      defaults={defaults}
      onOverride={() => patch(inForce(defaults, setting) as Partial<RawJob>)}
      onInherit={() => patch(inheritPatch(setting) as Partial<RawJob>)}
    />
  )
  const way = shown('direction')
  const direction: Direction = way.direction ?? 'both'
  const timing = shown('schedule')

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
      <div className="flex flex-col gap-4">
        <FieldRow label={t('edit.name')} hint={t('edit.nameHint')}>
          <Text value={job.name ?? ''} onChange={(v) => patch(rename(v))} label={t('edit.name')} />
        </FieldRow>
        <FieldRow label={t('edit.state')} hint={t('edit.stateHint')} width={PATH_W}>
          <Text value={job.state ?? ''} onChange={(v) => patch({ state: v })} label={t('edit.state')} mono />
        </FieldRow>

        <Side
          label={t('edit.left')}
          hint={t('edit.sideHint')}
          value={job.left ?? ''}
          known={known}
          onChange={(v) => patch({ left: v })}
        />
        <InheritedRow label={t('direction.label')} hint={t('direction.hint')} own={own('direction')} action={action('direction')}>
          <DirectionSwitch
            direction={direction}
            // Mirror and move need a source side. A two-way job says sync
            // rather than nothing, or it would take a default mirror.
            onChange={(v) => patch({ direction: v, mode: v === 'both' ? 'sync' : (job.mode ?? 'sync') })}
          />
        </InheritedRow>
        <Side
          label={t('edit.right')}
          hint={t('edit.sideHint')}
          value={job.right ?? ''}
          known={known}
          onChange={(v) => patch({ right: v })}
        />

        {/* The mode exists only once one side is the source. It comes with the
            direction, so its row has no button of its own. */}
        {direction !== 'both' && (
          <InheritedRow label={t('mode.label')} own={own('direction')} wide>
            <Selector<Mode>
              scale="small"
              label={t('mode.label')}
              hueOffset={HUE_OFFSET.mode}
              value={way.mode ?? 'sync'}
              onChange={(v) => patch({ mode: v })}
              options={MODES.map((m) => ({ value: m, label: t(`mode.${m}`), hint: t(`mode.${m}Hint`) }))}
            />
          </InheritedRow>
        )}

        <div data-new="schedule-sentence">
          <InheritedRow
            label={t('edit.schedule')}
            hint={t('edit.scheduleHint')}
            own={own('schedule')}
            action={action('schedule')}
          >
            <ScheduleButton label={t('edit.schedule')} value={timing.schedule ?? ''} watch={!!job.watch}>
              <ScheduleField
                value={timing.schedule ?? ''}
                onChange={(v) => patch({ schedule: v })}
                live={!!job.watch}
                onLive={(v) => patch({ watch: v })}
                settle={job.watchSettle ?? ''}
                onSettle={(v) => patch({ watchSettle: v })}
              />
            </ScheduleButton>
          </InheritedRow>
        </div>

        {/* Zero is written as 0s, since an empty quiet period is one the job
            leaves to the defaults. */}
        <InheritedRow
          label={t('edit.quietPeriod')}
          hint={t('edit.quietHint')}
          own={own('quietPeriod')}
          action={action('quietPeriod')}
        >
          <QuietPeriod
            value={shown('quietPeriod').quietPeriod ?? ''}
            onChange={(v) => patch({ quietPeriod: v || '0s' })}
          />
        </InheritedRow>
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
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3">
        <ToggleRow
          label={t('edit.runAtStart')}
          checked={!!job.runAtStart}
          onChange={(v) => patch({ runAtStart: v })}
          hint={t('edit.runAtStartHint')}
        />
        {(['emptyDirs', 'metadata'] as const).map((setting) => (
          <InheritedRow
            key={setting}
            label={t(`edit.${setting}`)}
            hint={t(`edit.${setting}Hint`)}
            own={own(setting)}
            action={action(setting)}
          >
            <Toggle
              checked={!!shown(setting)[setting]}
              onChange={(v) => patch({ [setting]: v })}
              label={t(`edit.${setting}`)}
              hideLabel
            />
          </InheritedRow>
        ))}
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
    <>
      <FieldRow label={label} hint={hint} width={PATH_W}>
        <span className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1">
            <Text value={value} onChange={onChange} label={label} mono />
          </span>
          <PickButton onClick={() => setPicking(true)} />
        </span>
      </FieldRow>
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
    </>
  )
}
