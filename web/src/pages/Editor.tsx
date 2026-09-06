import { useEffect, useState } from 'react'

import { Badge, Button, Card, Empty, Rule, Stack } from '../components/Shell'
import { Choice, Field, Lines, Switch, Text } from '../components/Field'
import { api, type Direction, type RawJob } from '../lib/api'
import { DIRECTIONS, DirectionGlyph, directionKey } from '../components/Direction'
import { Selector } from '../components/Selector'
import { useT } from '../lib/i18n'

/**
 * The job editor.
 *
 * It writes the configuration file and nothing else: the same file a person can
 * still open in an editor, validated by the same function that guards it there.
 * A refused edit leaves the file exactly as it was, because the new content is
 * written beside it and only moved into place once it has passed.
 */
export function Editor({ onSaved }: { onSaved: () => void }) {
  const { t } = useT()
  const [jobs, setJobs] = useState<RawJob[] | null>(null)
  const [chosen, setChosen] = useState(0)
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

  function patch(next: Partial<RawJob>) {
    setSaved(false)
    setJobs((prev) => prev && prev.map((j, i) => (i === chosen ? { ...j, ...next } : j)))
  }

  async function save() {
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
  }

  function addJob() {
    setSaved(false)
    setJobs((prev) => {
      const name = t('edit.newJob')
      const next: RawJob = { name, left: '', right: '', state: `state/${name}.db`, disabled: true }
      const all = [...(prev ?? []), next]
      setChosen(all.length - 1)
      return all
    })
  }

  function removeJob() {
    setSaved(false)
    setJobs((prev) => {
      if (!prev) return prev
      const all = prev.filter((_, i) => i !== chosen)
      setChosen(Math.max(0, Math.min(chosen, all.length - 1)))
      return all
    })
  }

  if (error && !jobs) {
    return (
      <Card title={t('edit.title')} hue={0}>
        <p className="text-[12px] text-statusFail">{error}</p>
      </Card>
    )
  }
  if (!jobs) {
    return (
      <Card title={t('edit.title')} hue={0}>
        <Empty>{t('edit.reading')}</Empty>
      </Card>
    )
  }

  const job = jobs[chosen]

  return (
    <Stack>
      <Card
        title={t('edit.title')}
        hue={0}
        actions={
          <>
            <Button onClick={addJob}>{t('edit.add')}</Button>
            <Button primary onClick={save} disabled={busy}>
              {busy ? t('edit.checking') : t('edit.save')}
            </Button>
          </>
        }
      >
        {error && <p className="mb-3 text-[12px] text-statusFail">{error}</p>}
        {saved && !error && <p className="mb-3 text-[12px] text-statusOk">{t('edit.savedNote')}</p>}

        {jobs.length === 0 ? (
          <Empty>{t('edit.noJobs')}</Empty>
        ) : (
          <ul className="flex flex-col">
            {jobs.map((j, i) => (
              <li key={i}>
                {i > 0 && <Rule />}
                <button
                  type="button"
                  onClick={() => setChosen(i)}
                  className={`flex w-full items-center gap-3 px-2 py-2 text-left transition ${
                    i === chosen ? 'bg-carbon-surface2' : 'hover:bg-carbon-hover'
                  }`}
                  style={{ borderRadius: 'var(--radius-control)' }}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {j.name || t('edit.unnamed')}
                  </span>
                  {j.disabled && <Badge tone="neutral">{t('jobs.state.disabled')}</Badge>}
                  {j.watch && <Badge tone="neutral">{t('edit.watching')}</Badge>}
                  <span className="shrink-0 text-[11px] text-carbon-textMuted">
                    {j.schedule || t('jobs.schedule.onRequest')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {job && (
        <Card
          title={job.name || t('edit.unnamed')}
          hue={1}
          actions={<Button onClick={removeJob}>{t('edit.remove')}</Button>}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('edit.name')} hint={t('edit.nameHint')}>
              <Text value={job.name ?? ''} onChange={(v) => patch({ name: v })} />
            </Field>
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
            <Side
              label={t('edit.right')}
              hint={t('edit.sideHint')}
              value={job.right ?? ''}
              known={known}
              onChange={(v) => patch({ right: v })}
            />
            <Field label={t('direction.label')} hint={t('direction.hint')}>
              {/* Arrows rather than three words: the choice reads at a glance
                  and takes the same room in every language. */}
              <Selector<Direction>
                scale="small"
                label={t('direction.label')}
                value={job.direction ?? 'both'}
                onChange={(v) => patch({ direction: v })}
                options={DIRECTIONS.map((d) => ({
                  value: d,
                  label: t(directionKey[d]),
                  icon: <DirectionGlyph direction={d} />,
                }))}
              />
            </Field>
            <Field label={t('edit.schedule')} hint={t('edit.scheduleHint')}>
              <Text value={job.schedule ?? ''} onChange={(v) => patch({ schedule: v })} mono />
            </Field>
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
        </Card>
      )}
    </Stack>
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
