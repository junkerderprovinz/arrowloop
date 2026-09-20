import { useCallback, useEffect, useMemo, useState } from 'react'

import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { Empty, Rule, RowActions, Stack } from '../components/Shell'
import { IconAction } from '../components/IconAction'
import { ProviderPicker } from '../components/ProviderPicker'
import { Card } from '../lib/glimstone/Card'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { ConfirmDialog } from '../lib/glimstone/ConfirmDialog'
import { IconCheck, IconCopy, IconDelete, IconEdit } from '../components/glyphs'
import { brandMark } from '../components/brandMarks'
import { Choice, Field, Secret, Text } from '../components/Field'
import { ToggleRow } from '../components/ToggleRow'
import { api, type Backend, type Provider, type Remote, type Usage, type Volume } from '../lib/api'
import { bytes } from '../lib/bytes'
import { useT } from '../lib/i18n'
import { optionHint } from '../lib/optionHint'
import { optionLabel } from '../lib/optionNames'
import { suggestTargetName } from '../lib/targetName'
import { Since } from './Jobs'

/** The storage targets and registered drives a job's sides can point at. */
export function Targets() {
  const { t } = useT()
  const [remotes, setRemotes] = useState<Remote[]>([])
  const [backends, setBackends] = useState<Backend[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [unlisted, setUnlisted] = useState<Backend[]>([])
  const [volumes, setVolumes] = useState<Volume[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    api
      .remotes()
      .then((r) => {
        setRemotes(r.remotes)
        setBackends(r.backends)
        setProviders(r.providers ?? [])
        setUnlisted(r.unlisted ?? [])
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
          <p className="text-xs text-statusFail">{error}</p>
        </Card>
      )}
      {/* Clouds hand over folders, bucket stores a container with a key and
          a secret, and protocols need a machine and an address (plain S3
          included, although it is Amazon's). */}
      <Storage
        group="cloud"
        title={t('targets.cloud')}
        hueIndex={0}
        remotes={remotes}
        backends={backends}
        providers={providers}
        unlisted={[]}
        onChanged={refresh}
      />
      <Storage
        group="storage"
        title={t('targets.storage')}
        hueIndex={1}
        remotes={remotes}
        backends={backends}
        providers={providers}
        unlisted={[]}
        onChanged={refresh}
      />
      <Storage
        group="protocol"
        title={t('targets.connections')}
        hueIndex={2}
        remotes={remotes}
        backends={backends}
        providers={providers}
        // An rclone backend with no provider entry counts as a protocol here.
        unlisted={unlisted}
        onChanged={refresh}
      />
      <Drives volumes={volumes} onChanged={refresh} />
    </Stack>
  )
}

function Storage({
  group,
  title,
  hueIndex,
  remotes,
  backends,
  providers,
  unlisted,
  onChanged,
}: {
  /** Which third of the providers this card offers. */
  group: 'cloud' | 'storage' | 'protocol'
  title: string
  hueIndex: number
  remotes: Remote[]
  backends: Backend[]
  providers: Provider[]
  unlisted: Backend[]
  onChanged: () => void
}) {
  const { t } = useT()
  const [editing, setEditing] = useState<string | null>(null)
  // Adding picks a product first, then shows that backend's fields, so nobody
  // has to know Nextcloud is "webdav". Null is closed, 'pick' is the list, and
  // a string is the chosen backend.
  const [adding, setAdding] = useState<null | 'pick' | string>(null)
  const [provider, setProvider] = useState<Provider | null>(null)

  const mine = useMemo(() => providers.filter((p) => p.group === group), [providers, group])

  // A saved target only remembers its rclone type, which several groups share
  // (s3 above all), so the cards claim backends in order: clouds, then
  // storage, and the protocols take the rest. No row appears twice.
  const claimed = useMemo(() => {
    const cloud = new Set(providers.filter((p) => p.group === 'cloud').map((p) => p.backend))
    const store = new Set(
      providers.filter((p) => p.group === 'storage' && !cloud.has(p.backend)).map((p) => p.backend),
    )
    return { cloud, store }
  }, [providers])
  const rows = useMemo(
    () =>
      remotes.filter((r) => {
        if (group === 'cloud') return claimed.cloud.has(r.type)
        if (group === 'storage') return claimed.store.has(r.type)
        return !claimed.cloud.has(r.type) && !claimed.store.has(r.type)
      }),
    [remotes, group, claimed],
  )

  return (
    <Card title={title} hueIndex={hueIndex}>
      {!adding && editing === null && (
        <div className="flex justify-end">
          <Button
            label={t('targets.addStorage')}
            labelKey="targets.addStorage"
            tone="accent"
            onClick={() => {
              setAdding('pick')
              setProvider(null)
              setEditing(null)
            }}
          />
        </div>
      )}
      {adding === 'pick' && (
        <ProviderPicker
          providers={mine}
          unlisted={unlisted}
          onPick={(picked) => {
            setProvider(typeof picked === 'string' ? null : picked)
            setAdding(typeof picked === 'string' ? picked : picked.backend)
          }}
          onCancel={() => setAdding(null)}
        />
      )}
      {adding !== null && adding !== 'pick' && (
        <RemoteForm
          backends={backends}
          kind={adding}
          provider={provider}
          taken={remotes.map((r) => r.name)}
          onDone={(saved) => {
            setAdding(null)
            if (saved) onChanged()
          }}
        />
      )}

      {rows.length === 0 && adding === null ? (
        <Empty>{t('targets.storageEmpty')}</Empty>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r, i) => (
            <li key={r.name}>
              {(i > 0 || adding !== null) && <Rule />}
              {editing === r.name ? (
                <RemoteForm
                  backends={backends}
                  existing={r}
                  // The engine identifies the product from the target's settings
                  // (internal/remotes/identify.go).
                  provider={mine.find((x) => x.id === r.provider) ?? null}
                  onDone={(saved) => {
                    setEditing(null)
                    if (saved) onChanged()
                  }}
                />
              ) : (
                <RemoteRow
                  remote={r}
                  row={i}
                  onEdit={() => {
                    setEditing(r.name)
                    setAdding(null)
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
  row,
  onEdit,
  onChanged,
}: {
  remote: Remote
  /**
   * The row's place in the list. Its actions take fixed palette offsets from
   * it, so a button keeps its colour when a neighbour is not rendered.
   */
  row: number
  onEdit: () => void
  onChanged: () => void
}) {
  const { t } = useT()
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; reason?: string } | null>(null)
  // How full the target is, fetched on the same press once the check has
  // succeeded.
  const [usage, setUsage] = useState<Usage | null>(null)
  // Deleting a target takes its credentials, which nothing here can restore.
  const [confirming, setConfirming] = useState(false)

  async function check() {
    setChecking(true)
    setResult(null)
    setUsage(null)
    try {
      const answer = await api.checkRemote(remote.name)
      setResult(answer)
      if (answer.ok) {
        // Many targets cannot report their space; that is no failure.
        try {
          setUsage(await api.aboutRemote(remote.name))
        } catch {
          setUsage(null)
        }
      }
    } catch (e) {
      setResult({ ok: false, reason: (e as Error).message })
    } finally {
      setChecking(false)
    }
  }

  // Enough settings to tell two targets apart; secrets never leave the engine.
  const summary = remote.settings
    .filter((s) => !s.secret && s.value)
    .slice(0, 3)
    .map((s) => `${s.key}=${s.value}`)
    .join('  ')

  return (
    <div className="group flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {/* The engine identifies the product and its mark from the saved
              settings (internal/remotes/identify.go). */}
          {remote.mark && brandMark(remote.mark) ? (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              {brandMark(remote.mark)}
            </span>
          ) : null}
          <span className="truncate text-sm font-medium">{remote.name}:</span>
          {/* The protocol only where no logo already says what this is. */}
          {remote.mark ? null : <Badge>{remote.type}</Badge>}
          {result && (
            <Badge tone={result.ok ? 'ok' : 'fail'}>
              {result.ok ? t('targets.checkOk') : t('targets.checkFailed')}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate font-mono text-xs text-carbon-textMuted" title={summary}>
          {summary}
        </p>
        {result && !result.ok && result.reason && (
          <p className="mt-1 text-xs text-statusFail">{result.reason}</p>
        )}
        {usage && <Space usage={usage} />}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {/* The check stays visible; the other actions appear on hover. */}
        <IconAction
          onClick={check}
          disabled={checking}
          title={checking ? t('targets.checking') : t('targets.check')}
          labelKey={checking ? 'targets.checking' : 'targets.check'}
          hint={t('targets.checkHint')}
          hueIndex={row + 1}
        >
          <IconCheck />
        </IconAction>
        <RowActions>
          <IconAction onClick={onEdit} title={t('action.edit')} labelKey="action.edit" hueIndex={row + 2}>
            <IconEdit />
          </IconAction>
          <IconAction
            title={t('action.delete')}
            labelKey="action.delete"
            hueIndex={row + 3}
            onClick={() => setConfirming(true)}
          >
            <IconDelete />
          </IconAction>
        </RowActions>
      </div>

      {confirming && (
        <ConfirmDialog
          title={t('confirm.deleteRemote')}
          message={t('confirm.deleteRemoteStakes', { name: remote.name })}
          confirmLabel={t('confirm.delete')}
          confirmGlyph={<IconDelete />}
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
 * How full a target is, drawn only as far as the target said. A bucket store
 * with no quota draws nothing rather than a bar at zero, and a figure without
 * its pair shows as words without the bar. Past nine tenths the bar warns,
 * since a sync may stop halfway.
 */
function Space({ usage }: { usage: Usage }) {
  const { t } = useT()
  if (!usage.supported) return null

  const total = usage.total
  const used =
    usage.used ?? (total !== undefined && usage.free !== undefined ? total - usage.free : undefined)
  const share = total && total > 0 && used !== undefined ? Math.min(1, used / total) : undefined

  const words =
    usage.free !== undefined && total !== undefined
      ? t('targets.spaceFree', { free: bytes(usage.free), total: bytes(total) })
      : used !== undefined
        ? t('targets.spaceUsed', { used: bytes(used) })
        : total !== undefined
          ? t('targets.spaceTotal', { total: bytes(total) })
          : null
  if (!words) return null

  return (
    <div className="mt-1.5 flex items-center gap-2">
      {share !== undefined && (
        <div
          className="h-1 w-24 shrink-0 overflow-hidden bg-carbon-surface3"
          style={{ borderRadius: 'var(--radius-pill)' }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
          aria-label={words}
        >
          <div
            className={`h-full ${share >= 0.9 ? 'bg-statusFailSolid' : share >= 0.75 ? 'bg-statusWarnSolid' : 'bg-accent'}`}
            style={{ width: `${share * 100}%` }}
          />
        </div>
      )}
      <span className="text-xs tabular-nums text-carbon-textMuted">{words}</span>
    </div>
  )
}

/**
 * The form for one target, built from the option metadata rclone carries for
 * each backend, so it stays right as backends gain options.
 */
function RemoteForm({
  backends,
  kind: chosen,
  provider,
  taken,
  existing,
  onDone,
}: {
  backends: Backend[]
  /** The backend, chosen in the provider picker before the form opens. */
  kind?: string
  /**
   * The picked provider: its preset settings, the name to suggest and the
   * shape of its address. Null for an unlisted backend.
   */
  provider?: Provider | null
  /** The names already in use, so a suggested one does not collide. */
  taken?: string[]
  existing?: Remote
  onDone: (saved: boolean) => void
}) {
  const { t } = useT()
  const preset = provider?.preset
  // Suggested from the product's own name, numbered when taken (`OpenCloud-2`).
  const [name, setName] = useState(() => {
    if (existing) return existing.name
    if (!provider) return ''
    return suggestTargetName(provider.name, taken ?? [])
  })
  const kind = existing?.type ?? chosen ?? backends[0]?.name ?? ''
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...(preset ?? {}),
    ...Object.fromEntries((existing?.settings ?? []).map((s) => [s.key, s.value])),
  }))
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [trying, setTrying] = useState(false)
  /** The result of a test run before saving. */
  const [tried, setTried] = useState<{ ok: boolean; reason?: string } | null>(null)

  const backend = useMemo(() => backends.find((b) => b.name === kind), [backends, kind])
  // Only rclone's required and essential options until the advanced switch
  // shows everything; s3 alone has fourteen non-advanced ones.
  const shown = useMemo(
    () =>
      (backend?.options ?? [])
        .filter((o) => advanced || o.required || o.essential)
        // A setting the chosen product already presets (the WebDAV vendor for
        // Nextcloud) is no question, outside the advanced view.
        .filter((o) => advanced || !preset || preset[o.name] === undefined),
    [backend, advanced, preset],
  )

  /**
   * Tests the settings save would send, preset included, without writing
   * anything (internal/remotes/trycheck.go).
   */
  async function tryIt() {
    setTrying(true)
    setTried(null)
    try {
      const filled = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''))
      // The name lets the engine fill in the saved secrets this form never
      // received.
      setTried(await api.tryRemote(kind, { ...(preset ?? {}), ...filled }, existing?.name))
    } catch (e) {
      setTried({ ok: false, reason: (e as Error).message })
    } finally {
      setTrying(false)
    }
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      // An empty field clears its setting, so only filled fields and existing
      // settings are sent, not every untouched option.
      const filled = Object.fromEntries(
        Object.entries(values).filter(([key, value]) => value !== '' || existing?.settings.some((s) => s.key === key)),
      )
      const saved = name.trim()
      await api.saveRemote(saved, kind, filled)
      // Checked after saving, so a typo shows at once rather than as a failed
      // run. The answer never blocks, since the server may simply be off.
      setBusy(false)
      setChecking(true)
      try {
        const answer = await api.checkRemote(saved)
        setChecking(false)
        if (!answer.ok) {
          setError(t('targets.savedButUnreachable', { reason: answer.reason ?? '' }))
          return
        }
      } catch {
        // A check that could not run says nothing about the target.
        setChecking(false)
      }
      onDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      {/* An OAuth token needs a browser at the provider's sign-in page on the
          engine's machine, which this interface cannot open, so the form names
          the command that produces one. */}
      {backend?.needsToken && (
        <p className="flex items-start gap-2 text-xs text-carbon-textMuted">
          <InfoBubble tip={t('targets.tokenHowTo')} />
          <span>{t('targets.tokenNeeded', { backend: backend.name })}</span>
        </p>
      )}
      {/* No backend type on screen: the picker already chose it in terms of
          products. */}
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <Field label={t('targets.remoteName')} hint={t('targets.remoteNameHint')}>
          <Text value={name} onChange={setName} placeholder="backup" mono />
        </Field>

        {shown.map((o) => (
          <Field
            key={o.name}
            label={optionLabel(o.name, t)}
            hint={optionHint(o, t, provider)}
          >
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

        <ToggleRow checked={advanced} onChange={setAdvanced} label={t('targets.advanced')} />

        {error && <p className="text-xs text-statusFail">{error}</p>}
      </div>

      {tried && (
        <p className={`text-xs ${tried.ok ? 'text-statusOk' : 'text-statusFail'}`}>
          {tried.ok ? t('targets.checkOk') : `${t('targets.checkFailed')}: ${tried.reason ?? ''}`}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button label={t('targets.cancel')} labelKey="targets.cancel" onClick={() => onDone(false)} />
        {/* Tests before anything is written; saving checks again afterwards. */}
        <Button
          label={trying ? t('targets.checking') : t('targets.check')}
          labelKey="targets.check"
          onClick={() => void tryIt()}
          disabled={busy || trying || !kind}
        />
        <Button
          label={checking ? t('targets.checking') : t('targets.save')}
          labelKey={checking ? 'targets.checking' : 'targets.save'}
          tone="accent"
          onClick={() => void save()}
          disabled={busy || checking || !name.trim() || !kind}
        />
      </div>
    </div>
  )
}

function Drives({ volumes, onChanged }: { volumes: Volume[]; onChanged: () => void }) {
  const { t } = useT()
  const [adding, setAdding] = useState(false)

  return (
    <Card
      title={t('targets.drives')}
      hint={t('targets.driveExplain')}
      hueIndex={1}
    >
      {!adding && (
        <div className="flex justify-end">
          <Button
            label={t('targets.registerDrive')}
            labelKey="targets.registerDrive"
            tone="accent"
            onClick={() => setAdding(true)}
          />
        </div>
      )}
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
              <DriveRow volume={v} row={i} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function DriveRow({
  volume,
  row,
  onChanged,
}: {
  volume: Volume
  /** The row's place in the list, as in RemoteRow. */
  row: number
  onChanged: () => void
}) {
  const { t } = useT()
  const [copied, setCopied] = useState(false)
  // Asks first, since deleting removes the identity file from the volume itself.
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="group flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{volume.label}</span>
          {/* Not the accent: an attached drive is a state, not activity. */}
          <Badge tone={volume.attached ? 'ok' : 'neutral'}>
            {volume.attached ? t('targets.attached') : t('targets.absent')}
          </Badge>
        </div>
        <p className="mt-0.5 truncate font-mono text-xs text-carbon-textMuted">
          {volume.attached ? volume.mount : volume.path}
        </p>
      </div>

      {!volume.attached && volume.lastSeen && (
        <span className="shrink-0 text-xs text-carbon-textMuted">
          {t('targets.lastSeen')}: <Since when={volume.lastSeen} />
        </span>
      )}

      <div className="flex shrink-0 items-center gap-1.5">
        <IconAction
          tone={copied ? 'accent' : 'subtle'}
          hueIndex={row + 1}
          title={copied ? t('targets.copied') : t('targets.copyPath')}
          labelKey={copied ? 'targets.copied' : 'targets.copyPath'}
          onClick={() => {
            void navigator.clipboard?.writeText(volume.path).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          <IconCopy />
        </IconAction>
        {/* Always visible rather than in RowActions: it is what somebody
            comes to this row to do. */}
        <IconAction
          title={t('targets.deleteDrive')}
          labelKey="targets.deleteDrive"
          hint={t('targets.deleteDriveHint')}
          hueIndex={row + 2}
          onClick={() => setConfirming(true)}
        >
          <IconDelete />
        </IconAction>
      </div>

      {confirming && (
        <ConfirmDialog
          title={t('confirm.deleteDrive')}
          message={t('confirm.deleteDriveStakes', { name: volume.label })}
          confirmLabel={t('confirm.delete')}
          confirmGlyph={<IconDelete />}
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            void api.forgetVolume(volume.id).then(onChanged)
          }}
        />
      )}
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
          <Button label={t('targets.cancel')} labelKey="targets.cancel" onClick={() => onDone(false)} />
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

      {error && <p className="text-xs text-statusFail">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button label={t('targets.cancel')} labelKey="targets.cancel" onClick={() => onDone(false)} />
        <Button label={t('targets.save')} labelKey="targets.save" tone="accent" onClick={() => void save()} disabled={busy || !mount} />
      </div>
    </div>
  )
}
