import { useCallback, useEffect, useMemo, useState } from 'react'

import { Badge, Button, Card, Confirm, Empty, IconButton, Rule, RowActions, Stack } from '../components/Shell'
import { IconCheck, IconCopy, IconDelete, IconEdit, IconForget } from '../components/glyphs'
import { Choice, Field, Secret, Switch, Text } from '../components/Field'
import { api, type Backend, type Remote, type Volume } from '../lib/api'
import { useT } from '../lib/i18n'
import { Since } from './Jobs'

/**
 * The two things a job needs before it can point anywhere: a place to reach and
 * a drive to recognise.
 *
 * Both are edited here rather than in a file. The alternative is telling
 * somebody to paste an S3 key into JSON by hand and to work out for themselves
 * which drive letter their disk will have next week.
 */
export function Targets() {
  const { t } = useT()
  const [remotes, setRemotes] = useState<Remote[]>([])
  const [backends, setBackends] = useState<Backend[]>([])
  const [volumes, setVolumes] = useState<Volume[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    api
      .remotes()
      .then((r) => {
        setRemotes(r.remotes)
        setBackends(r.backends)
      })
      .catch((e: Error) => setError(e.message))
    api
      .volumes()
      .then((v) => setVolumes(v.volumes))
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(refresh, [refresh])

  return (
    <Stack>
      {error && (
        <Card title={t('error.unreachable')}>
          <p className="text-[12px] text-statusFail">{error}</p>
        </Card>
      )}
      <Storage remotes={remotes} backends={backends} onChanged={refresh} />
      <Drives volumes={volumes} onChanged={refresh} />
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function Storage({
  remotes,
  backends,
  onChanged,
}: {
  remotes: Remote[]
  backends: Backend[]
  onChanged: () => void
}) {
  const { t } = useT()
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <Card
      title={t('targets.storage')}
      actions={
        !adding &&
        editing === null && (
          <Button
            onClick={() => {
              setAdding(true)
              setEditing(null)
            }}
          >
            {t('targets.addStorage')}
          </Button>
        )
      }
    >
      {adding && (
        <RemoteForm
          backends={backends}
          onDone={(saved) => {
            setAdding(false)
            if (saved) onChanged()
          }}
        />
      )}

      {remotes.length === 0 && !adding ? (
        <Empty>{t('targets.storageEmpty')}</Empty>
      ) : (
        <ul className="flex flex-col">
          {remotes.map((r, i) => (
            <li key={r.name}>
              {(i > 0 || adding) && <Rule />}
              {editing === r.name ? (
                <RemoteForm
                  backends={backends}
                  existing={r}
                  onDone={(saved) => {
                    setEditing(null)
                    if (saved) onChanged()
                  }}
                />
              ) : (
                <RemoteRow
                  remote={r}
                  onEdit={() => {
                    setEditing(r.name)
                    setAdding(false)
                  }}
                  onChanged={onChanged}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function RemoteRow({
  remote,
  onEdit,
  onChanged,
}: {
  remote: Remote
  onEdit: () => void
  onChanged: () => void
}) {
  const { t } = useT()
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; reason?: string } | null>(null)
  // Deleting a target takes its credentials with it, and nothing here can put
  // them back, so this one asks. Forgetting a drive does not: the marker stays
  // on the disk and plugging it in brings it straight back.
  const [confirming, setConfirming] = useState(false)

  async function check() {
    setChecking(true)
    setResult(null)
    try {
      setResult(await api.checkRemote(remote.name))
    } catch (e) {
      setResult({ ok: false, reason: (e as Error).message })
    } finally {
      setChecking(false)
    }
  }

  // The settings worth showing on a closed row: what somebody would use to tell
  // two targets apart. A password is not one of them and could not be shown
  // anyway; it never leaves the engine.
  const summary = remote.settings
    .filter((s) => !s.secret && s.value)
    .slice(0, 3)
    .map((s) => `${s.key}=${s.value}`)
    .join('  ')

  return (
    <div className="group flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">{remote.name}:</span>
          <Badge>{remote.type}</Badge>
          {result && (
            <Badge tone={result.ok ? 'ok' : 'fail'}>
              {result.ok ? t('targets.checkOk') : t('targets.checkFailed')}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate font-mono text-[11px] text-carbon-textMuted" title={summary}>
          {summary}
        </p>
        {result && !result.ok && result.reason && (
          <p className="mt-1 text-[11px] text-statusFail">{result.reason}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {/* The one thing somebody came to this row to do stays visible; the
            rest arrive when the pointer does.

            The explanation rides ON the button rather than beside it as its own
            (i). A bubble belongs next to a control's LABEL, and a row of
            icon-only buttons has no labels, so a lone (i) among them reads as a
            fourth button with a mystery behind it. An icon-only button already
            has to carry a tip to be nameable at all, so the sentence goes
            there, where a pointer heading for the button finds it. */}
        <IconButton
          onClick={check}
          disabled={checking}
          title={checking ? t('targets.checking') : t('targets.check')}
          hint={t('targets.checkHint')}
        >
          <IconCheck />
        </IconButton>
        <RowActions>
          <IconButton onClick={onEdit} title={t('targets.edit')}>
            <IconEdit />
          </IconButton>
          <IconButton tone="fail" title={t('targets.delete')} onClick={() => setConfirming(true)}>
            <IconDelete />
          </IconButton>
        </RowActions>
      </div>

      {confirming && (
        <Confirm
          title={t('confirm.deleteRemote')}
          stakes={t('confirm.deleteRemoteStakes', { name: remote.name })}
          confirmLabel={t('confirm.delete')}
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            void api.deleteRemote(remote.name).then(onChanged)
          }}
        />
      )}
    </div>
  )
}

/**
 * The form for one target, built from what the backend says about itself.
 *
 * Nothing here knows what an S3 endpoint or an SSH key is. rclone carries a
 * name, a help text, a default and often examples for every setting of every
 * backend, and it keeps them right because its own command line reads the same
 * thing. A copy written out here would start being wrong the first time a
 * backend gained an option.
 */
function RemoteForm({
  backends,
  existing,
  onDone,
}: {
  backends: Backend[]
  existing?: Remote
  onDone: (saved: boolean) => void
}) {
  const { t } = useT()
  const [name, setName] = useState(existing?.name ?? '')
  const [kind, setKind] = useState(existing?.type ?? backends[0]?.name ?? '')
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((existing?.settings ?? []).map((s) => [s.key, s.value])),
  )
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const backend = useMemo(() => backends.find((b) => b.name === kind), [backends, kind])
  const shown = useMemo(
    () => (backend?.options ?? []).filter((o) => advanced || o.required || !o.advanced),
    [backend, advanced],
  )

  async function save() {
    setBusy(true)
    setError(null)
    try {
      // Only the settings somebody actually filled in are sent. An empty field
      // deletes its setting, which is how a value gets cleared, but sending
      // every untouched advanced option as an empty string would clear a whole
      // configuration on the first edit.
      const filled = Object.fromEntries(
        Object.entries(values).filter(([key, value]) => value !== '' || existing?.settings.some((s) => s.key === key)),
      )
      await api.saveRemote(name.trim(), kind, filled)
      onDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('targets.remoteName')} hint={t('targets.remoteNameHint')}>
          <Text value={name} onChange={setName} placeholder="backup" mono />
        </Field>
        <Field label={t('targets.kind')}>
          <Choice
            value={kind}
            onChange={setKind}
            label={t('targets.kind')}
            options={backends.map((b) => ({ value: b.name, label: b.name }))}
          />
        </Field>
      </div>

      {backend && <p className="text-[11px] text-carbon-textMuted">{backend.description}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {shown.map((o) => (
          <Field
            key={o.name}
            label={o.required ? `${o.name} (${t('targets.required')})` : o.name}
            hint={o.help || undefined}
          >
            {/* A field the backend calls a secret is drawn as one, with its
                own show and hide control inside it. */}
            {o.secret ? (
              <Secret
                value={values[o.name] ?? ''}
                onChange={(next) => setValues((prev) => ({ ...prev, [o.name]: next }))}
                placeholder={values[o.name] ? t('targets.secretSet') : o.default}
              />
            ) : (
              <Text
                value={values[o.name] ?? ''}
                onChange={(next) => setValues((prev) => ({ ...prev, [o.name]: next }))}
                placeholder={o.default || o.examples?.[0]?.value}
                mono
              />
            )}
          </Field>
        ))}
      </div>

      <Switch on={advanced} onChange={setAdvanced} label={t('targets.advanced')} />

      {error && <p className="text-[11px] text-statusFail">{error}</p>}

      <div className="flex items-center gap-2">
        <Button primary onClick={save} disabled={busy || !name.trim() || !kind}>
          {t('targets.save')}
        </Button>
        <Button onClick={() => onDone(false)}>{t('targets.cancel')}</Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drives
// ---------------------------------------------------------------------------

function Drives({ volumes, onChanged }: { volumes: Volume[]; onChanged: () => void }) {
  const { t } = useT()
  const [adding, setAdding] = useState(false)

  return (
    <Card
      title={t('targets.drives')}
      hint={t('targets.driveExplain')}
      actions={
        <div className="flex items-center gap-2">
          {!adding && <Button onClick={() => setAdding(true)}>{t('targets.registerDrive')}</Button>}
        </div>
      }
    >
      {adding && (
        <DriveForm
          onDone={(saved) => {
            setAdding(false)
            if (saved) onChanged()
          }}
        />
      )}

      {volumes.length === 0 && !adding ? (
        <Empty>{t('targets.drivesEmpty')}</Empty>
      ) : (
        <ul className="flex flex-col">
          {volumes.map((v, i) => (
            <li key={v.id}>
              {(i > 0 || adding) && <Rule />}
              <DriveRow volume={v} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function DriveRow({ volume, onChanged }: { volume: Volume; onChanged: () => void }) {
  const { t } = useT()
  const [copied, setCopied] = useState(false)

  return (
    <div className="group flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">{volume.label}</span>
          {/* Attached is a state and states are badges. It is deliberately not
              the accent: a list of drives sitting there is not activity. */}
          <Badge tone={volume.attached ? 'ok' : 'neutral'}>
            {volume.attached ? t('targets.attached') : t('targets.absent')}
          </Badge>
        </div>
        <p className="mt-0.5 truncate font-mono text-[11px] text-carbon-textMuted">
          {volume.attached ? volume.mount : volume.path}
        </p>
      </div>

      {!volume.attached && volume.lastSeen && (
        <span className="shrink-0 text-[11px] text-carbon-textMuted">
          {t('targets.lastSeen')}: <Since when={volume.lastSeen} />
        </span>
      )}

      <div className="flex shrink-0 items-center gap-1.5">
        <IconButton
          tone={copied ? 'ok' : 'neutral'}
          title={copied ? t('targets.copied') : t('targets.copyPath')}
          onClick={() => {
            void navigator.clipboard?.writeText(volume.path).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          <IconCopy />
        </IconButton>
        <RowActions>
          {/* Same as the check button above: the sentence rides on the button
              rather than standing beside it as a lone (i) among icons. */}
          <IconButton
            title={t('targets.forget')}
            hint={t('targets.forgetHint')}
            onClick={() => {
              void api.forgetVolume(volume.id).then(onChanged)
            }}
          >
            <IconForget />
          </IconButton>
        </RowActions>
      </div>
    </div>
  )
}

function DriveForm({ onDone }: { onDone: (saved: boolean) => void }) {
  const { t } = useT()
  const [candidates, setCandidates] = useState<{ mount: string; marked: boolean }[]>([])
  const [mount, setMount] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .volumeCandidates()
      .then((c) => {
        // A drive that already carries a marker is not offered again: marking it
        // twice is harmless but the list is for finding the one that is not
        // registered yet.
        const fresh = c.candidates.filter((x) => !x.marked)
        setCandidates(fresh)
        setMount((current) => current || fresh[0]?.mount || '')
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await api.markVolume(mount, label.trim())
      onDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (candidates.length === 0 && !error) {
    return (
      <div className="py-4">
        <Empty>{t('targets.noCandidates')}</Empty>
        <div className="flex justify-center">
          <Button onClick={() => onDone(false)}>{t('targets.cancel')}</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('targets.driveMount')}>
          <Choice
            value={mount}
            onChange={setMount}
            label={t('targets.driveMount')}
            options={candidates.map((c) => ({ value: c.mount, label: c.mount }))}
          />
        </Field>
        <Field label={t('targets.driveLabel')} hint={t('targets.driveLabelHint')}>
          <Text value={label} onChange={setLabel} placeholder="Backup drive" />
        </Field>
      </div>

      {error && <p className="text-[11px] text-statusFail">{error}</p>}

      <div className="flex items-center gap-2">
        <Button primary onClick={save} disabled={busy || !mount}>
          {t('targets.save')}
        </Button>
        <Button onClick={() => onDone(false)}>{t('targets.cancel')}</Button>
      </div>
    </div>
  )
}
