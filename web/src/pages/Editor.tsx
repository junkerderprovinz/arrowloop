import { useEffect, useState } from 'react'

import { Badge, Button, Card, Empty, Rule, Stack } from '../components/Shell'
import { Field, Lines, Switch, Text } from '../components/Field'
import { api, type RawJob } from '../lib/api'

/**
 * The job editor.
 *
 * It writes the configuration file and nothing else: the same file a person can
 * still open in an editor, validated by the same function that guards it there.
 * A refused edit leaves the file exactly as it was, because the new content is
 * written beside it and only moved into place once it has passed.
 */
export function Editor({ onSaved }: { onSaved: () => void }) {
  const [jobs, setJobs] = useState<RawJob[] | null>(null)
  const [chosen, setChosen] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .config()
      .then((c) => setJobs(c.jobs))
      .catch((e: Error) => setError(e.message))
  }, [])

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
      const next: RawJob = { name: 'new-job', left: '', right: '', state: 'state/new-job.db', disabled: true }
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
      <Card title="Jobs">
        <p className="text-[12px] text-statusFail">{error}</p>
      </Card>
    )
  }
  if (!jobs) {
    return (
      <Card title="Jobs">
        <Empty>Reading the configuration.</Empty>
      </Card>
    )
  }

  const job = jobs[chosen]

  return (
    <Stack>
      <Card
        title="Jobs"
        actions={
          <>
            <Button onClick={addJob}>Add</Button>
            <Button primary onClick={save} disabled={busy}>
              {busy ? 'Checking' : 'Save'}
            </Button>
          </>
        }
      >
        {error && <p className="mb-3 text-[12px] text-statusFail">{error}</p>}
        {saved && !error && (
          <p className="mb-3 text-[12px] text-statusOk">Saved. The schedules and watchers were rebuilt.</p>
        )}

        {jobs.length === 0 ? (
          <Empty>No jobs yet. Add one.</Empty>
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
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{j.name || 'unnamed'}</span>
                  {j.disabled && <Badge tone="neutral">disabled</Badge>}
                  {j.watch && <Badge tone="neutral">watching</Badge>}
                  <span className="shrink-0 text-[11px] text-carbon-textMuted">{j.schedule || 'on request'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {job && (
        <Card
          title={job.name || 'unnamed'}
          actions={<Button onClick={removeJob}>Remove</Button>}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" hint="How the job is asked for by name and how its history is kept apart from the others. Two jobs cannot share one.">
              <Text value={job.name ?? ''} onChange={(v) => patch({ name: v })} />
            </Field>
            <Field label="State" hint="Where this job remembers what the two sides agreed on last time. Without it every file on both sides looks new, so this file has to survive.">
              <Text value={job.state ?? ''} onChange={(v) => patch({ state: v })} mono />
            </Field>
            <Field label="Left" hint="A local path or any rclone remote, for example sftp:backup/photos or s3:bucket/photos.">
              <Text value={job.left ?? ''} onChange={(v) => patch({ left: v })} mono />
            </Field>
            <Field label="Right" hint="The other end. Which side is left and which is right makes no difference to the engine.">
              <Text value={job.right ?? ''} onChange={(v) => patch({ right: v })} mono />
            </Field>
            <Field label="Schedule" hint="A cron expression, for example */15 * * * * for every quarter hour. Leave it empty and the job only runs when somebody asks for it.">
              <Text value={job.schedule ?? ''} onChange={(v) => patch({ schedule: v })} mono />
            </Field>
            <Field label="Quiet period" hint="How long a file has to sit unchanged before it is touched, for example 5s. This is what stops a half-written document being copied.">
              <Text value={job.quietPeriod ?? ''} onChange={(v) => patch({ quietPeriod: v })} mono />
            </Field>
          </div>

          <div className="mt-5">
            <Field label="Exclude" hint="One glob per line. Without a slash it matches the file name at any depth; with one it matches the whole path. Excluding a file that was already synced never deletes it.">
              <Lines
                value={(job.exclude ?? []).join('\n')}
                onChange={(v) => patch({ exclude: v.split('\n').map((l) => l.trim()).filter(Boolean) })}
                placeholder={'*.tmp\n**/node_modules/**'}
              />
            </Field>
          </div>

          <div className="mt-5 flex flex-col gap-3">
            <Switch
              label="Disabled"
              on={!!job.disabled}
              onChange={(v) => patch({ disabled: v })}
              hint="Keeps the job in the file without running it. A job you are still setting up should stay here until you have read its preview once."
            />
            <Switch
              label="Watch a local side"
              on={!!job.watch}
              onChange={(v) => patch({ watch: v })}
              hint="Runs when a local folder changes instead of waiting for the next tick. It needs a schedule as well: only a local side can be watched, and a watcher that missed something has no way to know it did."
            />
            <Switch
              label="Carry empty folders"
              on={!!job.emptyDirs}
              onChange={(v) => patch({ emptyDirs: v })}
              hint="A folder with files in it travels anyway. An empty one has nothing to imply it, so it needs a record of its own. Off for a bucket target, which has no real folders."
            />
            <Switch
              label="Carry permissions"
              on={!!job.metadata}
              onChange={(v) => patch({ metadata: v })}
              hint="Permissions, ownership and extended attributes travel with the bytes, where both sides can store them."
            />
          </div>
        </Card>
      )}
    </Stack>
  )
}
