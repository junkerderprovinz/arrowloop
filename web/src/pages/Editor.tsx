import { useCallback, useEffect, useState } from 'react'

import { Choice, Field, Info, Lines, Switch, Text } from '../components/Field'
import { api, type RawJob } from '../lib/api'
import { DirectionSwitch } from '../components/Direction'
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

  const save = useCallback(async () => {
    if (!jobs) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.saveConfig(jobs)
      setJobs(result.jobs)
      setSaved(true)
      onSaved()
    } catch (e) {
      // The message comes from the validator, so it says the same thing it
      // would say about a hand-written file.
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [jobs, onSaved])

  /**
   * Adds a job and hands back where it landed, so the caller can open it.
   *
   * It starts disabled on purpose: a job with no sides yet is not one anybody
   * wants a scheduler to reach, and switching it on is the deliberate act that
   * says it is ready.
   */
  const add = useCallback((): number => {
    setSaved(false)
    let at = 0
    setJobs((prev) => {
      const name = t('edit.newJob')
      const next: RawJob = { name, left: '', right: '', state: `state/${name}.db`, disabled: true }
      const all = [...(prev ?? []), next]
      at = all.length - 1
      return all
    })
    return at
  }, [t])

  const remove = useCallback((at: number) => {
    setSaved(false)
    setJobs((prev) => prev && prev.filter((_, i) => i !== at))
  }, [])

  return { jobs, known, error, saved, busy, patch, save, add, remove }
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
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('edit.name')} hint={t('edit.nameHint')}>
          <Text value={job.name ?? ''} onChange={(v) => patch({ name: v })} />
        </Field>
        <Field label={t('edit.state')} hint={t('edit.stateHint')}>
          <Text value={job.state ?? ''} onChange={(v) => patch({ state: v })} mono />
        </Field>

        <div className="flex items-start gap-3 sm:col-span-2">
          <div className="min-w-0 flex-1">
            <Side
              label={t('edit.left')}
              hint={t('edit.sideHint')}
              value={job.left ?? ''}
              known={known}
              onChange={(v) => patch({ left: v })}
            />
          </div>
          {/* The caption goes above the arrow exactly as it does above the two
              fields beside it, so the three read as one row of labelled things
              rather than a control that wandered in. The bubble rides on the
              caption, which is where every other field in this form puts it. */}
          <div className="flex shrink-0 flex-col gap-1.5">
            <span className="flex items-center justify-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-carbon-textMuted">
              <Info text={t('direction.hint')} />
            </span>
            <DirectionSwitch
              direction={job.direction ?? 'both'}
              onChange={(v) => patch({ direction: v })}
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

        <div className="sm:col-span-2">
          <Field label={t('edit.schedule')} hint={t('edit.scheduleHint')}>
            <ScheduleField value={job.schedule ?? ''} onChange={(v) => patch({ schedule: v })} />
          </Field>
        </div>

        <Field label={t('edit.quietPeriod')} hint={t('edit.quietHint')}>
          <Text value={job.quietPeriod ?? ''} onChange={(v) => patch({ quietPeriod: v })} mono />
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
        <Switch
          label={t('edit.disabled')}
          on={!!job.disabled}
          onChange={(v) => patch({ disabled: v })}
          hint={t('edit.disabledHint')}
        />
        <Switch
          label={t('edit.watch')}
          on={!!job.watch}
          onChange={(v) => patch({ watch: v })}
          hint={t('edit.watchHint')}
        />
        <Switch
          label={t('edit.emptyDirs')}
          on={!!job.emptyDirs}
          onChange={(v) => patch({ emptyDirs: v })}
          hint={t('edit.emptyDirsHint')}
        />
        <Switch
          label={t('edit.metadata')}
          on={!!job.metadata}
          onChange={(v) => patch({ metadata: v })}
          hint={t('edit.metadataHint')}
        />
      </div>
    </>
  )
}

/**
 * One side of a job: a text field, plus a list of the things already registered.
 *
 * The list writes the prefix and leaves the rest of the path to be typed, rather
 * than replacing whatever was there. A picker that overwrote the field would
 * lose the subfolder somebody had just entered, which is the only part they
 * could not have picked from a list.
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
  const { t } = useT()
  return (
    <div className="flex flex-col gap-1.5">
      <Field label={label} hint={hint}>
        <Text value={value} onChange={onChange} mono />
      </Field>
      {known.length > 0 && (
        <Choice
          value=""
          label={t('edit.pick')}
          onChange={(prefix) => prefix && onChange(prefix)}
          options={[{ value: '', label: t('edit.pick') }, ...known]}
        />
      )}
    </div>
  )
}
