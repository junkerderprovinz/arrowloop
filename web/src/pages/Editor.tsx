import { useCallback, useEffect, useState } from 'react'

import { Field, Lines, Text } from '../components/Field'
import { ToggleRow } from '../components/ToggleRow'
import { api, type RawJob } from '../lib/api'
import { DirectionSwitch } from '../components/Direction'
import { QuietPeriod } from '../components/QuietPeriod'
import { FolderPicker, PickButton } from '../components/FolderPicker'
import { ScheduleField } from '../components/Schedule'
import { useT } from '../lib/i18n'

/**
 * The configuration a job list edits, and everything that can be done to it.
 *
 * This is a hook rather than a page because the list and the form are now on
 * the same tab: a job is added, picked and edited without going anywhere, so
 * the state they share has to live above both of them. It writes the same
 * configuration file a person can still open in an editor, validated by the
 * same function that guards it there, and a refused edit leaves the file
 * exactly as it was because the new content is written beside it and only moved
 * into place once it has passed.
 */
/**
 * What a new job starts out ignoring.
 *
 * These used to be a placeholder in the box, which is grey text that vanishes
 * the moment anybody types and was never actually part of the job: every new
 * job shipped with an empty exclude list and copied its way through somebody's
 * caches. They are real values now.
 *
 * Chosen for one reason only: each is a file the operating system or a tool
 * rewrites on its own, so syncing it means copying noise back and forth for
 * ever and generating conflicts out of nothing. Nothing here is about taste,
 * and anything a person might actually want is left alone.
 */
export const DEFAULT_EXCLUDES = [
  // Half-written by definition.
  '*.tmp',
  '*.temp',
  '*.part',
  '*.crdownload',
  '~$*',
  // The file managers, written on merely LOOKING at a folder.
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

  // What a side can point at without anybody typing it: a registered drive or a
  // configured target. Both are set up on the Targets tab, and a job that has to
  // repeat their exact spelling by hand is a job with a typo in it.
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
   * Writes a list to the file and takes back what the server made of it.
   *
   * Takes the list rather than reading `jobs`, because the two callers below
   * need different ones: saving means "this list", removing means "this list
   * minus one", and a remove that went through `jobs` would write the list
   * from before the removal.
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
        // The message comes from the validator, so it says the same thing it
        // would say about a hand-written file.
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
   * Adds a job and hands back where it landed, so the caller can open it.
   *
   * The index is worked out from the CURRENT jobs, not from inside the updater.
   * React runs an updater when it gets round to it, so a value assigned in
   * there and returned from here is the value from before the click: the first
   * version of this opened the job above the new one, every time. There is one
   * writer to this state, so the length now is where the new job lands.
   *
   * The name carries a number as soon as one is taken, because two jobs called
   * the same thing are one job as far as every list, log and record is
   * concerned, and the second plus press is exactly when that happens.
   *
   * It starts disabled on purpose: a job with no sides yet is not one anybody
   * wants a scheduler to reach, and switching it on is the deliberate act that
   * says it is ready.
   */
  const add = useCallback((): number => {
    setSaved(false)
    const current = jobs ?? []
    const base = t('edit.newJob')
    let name = base
    for (let n = 2; current.some((j) => j.name === name); n++) name = `${base}-${n}`
    const next: RawJob = {
      name,
      left: '',
      right: '',
      state: `state/${name}.db`,
      disabled: true,
      exclude: [...DEFAULT_EXCLUDES],
    }
    setJobs([...current, next])
    return current.length
  }, [jobs, t])

  /**
   * Removes a job, and writes the file straight away.
   *
   * It used to change the list in the browser and stop there, so a job was
   * gone from the page and still in the file: reload and it was back. Reported
   * as "den example auftrag kann ich nicht löschen", which is exactly what it
   * looks like from the outside. A removal is a confirmed, deliberate act, so
   * it does not wait for a second press somewhere else.
   *
   * `alsoState` deletes the job's own state database first, while the job is
   * still IN the configuration: the server resolves the path from the job's
   * own entry rather than being handed one, so nothing here can name a file
   * outside the configuration. Doing it second would leave the server with no
   * way to look the path up. A failure there does not stop the removal, and it
   * is not silent either: the file is a cache of what the two sides agreed on,
   * not the user's data, and refusing to remove a job because a leftover
   * database could not be deleted would be the worse answer.
   */
  const remove = useCallback(
    async (at: number, alsoState: boolean) => {
      const current = jobs ?? []
      const job = current[at]
      if (!job) return
      setSaved(false)
      // A job with no name has never been saved, so there is no state database
      // on disk under it and nothing to ask the server about.
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
   * Hold a job's schedule, or let it go again, and write it straight away.
   *
   * Separate from `patch` on purpose. `patch` edits the draft in the open form
   * and waits for a save; this is pressed on a card that is not being edited,
   * where there is no save button to press afterwards and no form open to say
   * that something is pending. A switch that visibly flips and then quietly
   * does not persist is the same defect deleting a job had, and it took a live
   * click to find that one.
   *
   * It does NOT touch whether the job can be started by hand. A held job that
   * could no longer be started would be a deleted job with extra steps; the
   * whole point of holding one is to keep it and run it when you decide to.
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
   * Copy a job, and open the copy for editing.
   *
   * The copy is switched OFF and carries no state database of its own yet: two
   * jobs pointing at the same state file would each write what the other just
   * wrote, and the first run of the pair would look like every file had changed
   * on both sides. So the copy gets a fresh name and a state path derived from
   * it, the same way a new job does.
   *
   * Not written to disk. Duplicating is the START of an edit rather than the
   * end of one - nobody wants two identical jobs, they want the second one
   * pointing somewhere else - so it behaves like the plus button: a draft in
   * the form, saved when it says what it is for.
   */
  const duplicate = useCallback(
    (at: number): number => {
      setSaved(false)
      const current = jobs ?? []
      const source = current[at]
      if (!source) return at
      const base = `${source.name ?? t('edit.newJob')}-${t('edit.copySuffix')}`
      let name = base
      for (let n = 2; current.some((j) => j.name === name); n++) name = `${base}-${n}`
      const copy: RawJob = {
        ...source,
        name,
        state: `state/${name}.db`,
        disabled: true,
      }
      setJobs([...current, copy])
      return current.length
    },
    [jobs, t],
  )

  return { jobs, known, error, saved, busy, patch, save, add, remove, setDisabled, duplicate }
}

/**
 * One job's fields.
 *
 * The two sides and the arrow between them are one row, because the direction
 * is a fact about the pair: anywhere else on the form and the reader has to
 * hold both boxes in their head to make sense of it.
 */
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

  /**
   * Renaming a job carries its state database along, unless somebody has moved
   * it themselves.
   *
   * The two are written together when a job is created, as `state/<name>.db`,
   * and then the name changes and the path does not: a job called "photos"
   * with a database called `state/neuer-auftrag.db`. Nobody notices until they
   * go looking for the file. So the path follows the name for as long as it
   * still LOOKS like the generated one, and stops the moment it does not,
   * because a path somebody typed on purpose is not this function's to rewrite.
   */
  function rename(next: string): Partial<RawJob> {
    const generated = (n: string) => `state/${n}.db`
    const current = job.state ?? ''
    if (current !== '' && current !== generated(job.name ?? '')) return { name: next }
    return { name: next, state: generated(next) }
  }

  return (
    <>
      {/* Name and state database sit in the SAME three-part row the two sides
          below use: field, spacer the width of a pick button, field. They used
          to be an ordinary two-column grid, so each ended one button's width
          short of the box under it and no column in the form lined up with any
          other. Reported as exactly that measurement. The spacer is inert and
          hidden from assistive technology: it exists to hold a column open. */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Field label={t('edit.name')} hint={t('edit.nameHint')}>
              <Text value={job.name ?? ''} onChange={(v) => patch(rename(v))} />
            </Field>
          </div>
          <div className="shrink-0 pt-[1.55rem]" aria-hidden>
            <div className="h-[var(--btn-h)] w-[var(--btn-h)]" />
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
          {/* A caption row with nothing in it but an (i) was a bubble hanging
              off no label, which is the one shape rule 8 rules out: the (i)
              belongs BESIDE a label, and there was none. The explanation moved
              onto the arrow itself, which already carries a tip because it is
              an icon-only control, and the empty caption row went with it. The
              spacer keeps the arrow level with the two boxes rather than with
              the words above them. */}
          <div className="flex shrink-0 flex-col gap-1.5 pt-[1.55rem]">
            <DirectionSwitch
              direction={job.direction ?? 'both'}
              onChange={(v) => patch({ direction: v })}
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

        {/* The quiet period sits BESIDE the schedule, not under it. Both answer
            "when does this run", and a field alone on a row below reads as its
            own subject; there it was a bare duration box with no idea what to
            put in it.

            And it sits in the SAME three-part row as the two above: field,
            spacer the width of a pick button, field. It used to be flex-1 next
            to a fixed 14rem box, so it was the one row in the form whose two
            columns matched nothing above them. jdp asked for it by the column
            it should match rather than by a number ("ruhezeit feld soll so
            breit sein wie das der zustandsdatei"), which is the right way to
            ask: a width copied from a neighbour cannot drift, a width written
            as 14rem can. */}
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
            <div className="h-[var(--btn-h)] w-[var(--btn-h)]" />
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
          label={t('edit.disabled')}
          checked={!!job.disabled}
          onChange={(v) => patch({ disabled: v })}
          hint={t('edit.disabledHint')}
        />
        {/* The watcher used to be here, and it moved INTO the schedule field
            above: jdp went looking for it there ("zeitplan: echtzeit option
            fehlt") and he was looking in the right place. Two copies of one
            switch would have been worse than the wrong place, so this is a
            move rather than an addition.

            "Run at start" stays, because it answers a different question. The
            schedule says when, the watcher says also-when-something-happens,
            and this one says what to do about the turns that were missed while
            the machine was off. */}
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
      </div>
    </>
  )
}

/**
 * One side of a job: a field, a button that walks the folders, and a list of
 * the things already registered.
 *
 * The browse button is always there, and that is the fix for what it replaced:
 * the registered list only appeared once a target or a drive existed, so on a
 * fresh installation there was no way to choose a side at all, only a box to
 * type into. The first job somebody ever makes is exactly the one where they
 * have registered nothing.
 *
 * The list writes the prefix and leaves the rest of the path to be typed, rather
 * than replacing whatever was there. A picker that overwrote the field would
 * lose the subfolder somebody had just entered, which is the only part they
 * could not have picked from a list. The folder browser DOES replace the value,
 * because what it returns is a whole real path rather than a prefix.
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
      {/* The registered drives and configured targets are offered INSIDE the
          picker now, at the top of its list, rather than in a second dropdown
          under the field. They were findable only by noticing a control below
          the box, so the one thing a target exists for, being picked without
          retyping its exact spelling, was the hardest thing to reach. */}
      <FolderPicker
        open={picking}
        known={known}
        // A value with a colon in it is a target's name, not a folder on this
        // machine, so the browser starts at the top rather than failing to read
        // something that was never a path.
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
