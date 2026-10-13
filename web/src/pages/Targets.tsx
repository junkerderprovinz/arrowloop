import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { Empty, Rows, Stack } from '../components/Shell'
import { Dialog } from '../components/Dialog'
import { IconAction } from '../components/IconAction'
import { PageAction, PageActions } from '../components/PageActions'
import { PickerSearch } from '../components/PickerSearch'
import { ProviderPicker } from '../components/ProviderPicker'
import { Since } from '../components/Since'
import { Card } from '../lib/glimstone/Card'
import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { ConfirmDialog } from '../lib/glimstone/ConfirmDialog'
import {
  IconAdd,
  IconBack,
  IconCheck,
  IconCheckDraw,
  IconClose,
  IconCopy,
  IconFolder,
  IconPencil,
  IconSave,
  IconTabStorage,
  IconTrash,
} from '../components/glyphs'
import { brandMark } from '../components/brandMarks'
import { Choice, Field, Text } from '../components/Field'
import { replay } from '../lib/animate'
import { DropdownListbox } from '../lib/glimstone/DropdownListbox'
import {
  api,
  type Backend,
  type CheckAnswer,
  type DriveCandidate,
  type Provider,
  type Remote,
  type Share,
  type Usage,
  type Volume,
} from '../lib/api'
import { bytes } from '../lib/bytes'
import { groupStage } from '../lib/controls'
import { isLocalTarget } from '../lib/localTarget'
import { useT } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { optionHint, providerName } from '../lib/optionHint'
import { matchesQuery } from '../lib/fold'
import { optionLabel } from '../lib/optionNames'
import { suggestTargetName } from '../lib/targetName'
import { setTargetCount } from '../lib/targetCount'
import { errorText } from '../lib/errorText'
import { SecretRow } from './settings/rows'
import { failureLine } from '../lib/failure'

/**
 * The storage targets and registered drives a job's sides can point at, one
 * card per kind. Adding a target is what the page is for, so it is the
 * corner's filled action, with registering a drive beside it.
 */
export function Targets() {
  const { t } = useT()
  const [remotes, setRemotes] = useState<Remote[]>([])
  const [backends, setBackends] = useState<Backend[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [unlisted, setUnlisted] = useState<Backend[]>([])
  const [volumes, setVolumes] = useState<Volume[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [registering, setRegistering] = useState(false)

  const refresh = useCallback(() => {
    const targets = api.remotes().then((r) => {
      setRemotes(r.remotes)
      setBackends(r.backends)
      setProviders(r.providers ?? [])
      setUnlisted(r.unlisted ?? [])
      return r.remotes.length
    })
    const drives = api.volumes().then((v) => {
      setVolumes(v.volumes)
      return v.volumes.length
    })
    Promise.all([targets, drives])
      .then(([saved, registered]) => {
        setError(null)
        setTargetCount({ targets: saved, drives: registered })
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(refresh, [refresh])

  // A saved target only remembers its rclone type, which several groups share
  // (s3 above all), so the cards claim backends in order: clouds, then
  // storage, and the protocols take the rest. No row appears twice.
  const rows = useMemo(() => {
    const cloud = new Set(providers.filter((p) => p.group === 'cloud').map((p) => p.backend))
    const store = new Set(providers.filter((p) => p.group === 'storage' && !cloud.has(p.backend)).map((p) => p.backend))
    return {
      cloud: remotes.filter((r) => cloud.has(r.type)),
      storage: remotes.filter((r) => store.has(r.type)),
      protocol: remotes.filter((r) => !cloud.has(r.type) && !store.has(r.type)),
    }
  }, [remotes, providers])

  return (
    <Stack>
      {error && (
        <Card title={t('error.unreachable')}>
          <p className="text-subline text-statusFail">{error}</p>
        </Card>
      )}
      {/* Clouds hand over folders, bucket stores a container with a key and
          a secret, and protocols need a machine and an address (plain S3
          included, although it is Amazon's). */}
      {GROUPS.map((group, i) => (
        <Storage
          key={group}
          group={group}
          hueIndex={i}
          rows={rows[group]}
          marked={group === GROUPS.find((g) => rows[g].length > 0)}
          backends={backends}
          providers={providers.filter((p) => p.group === group)}
          onChanged={refresh}
        />
      ))}
      <Drives volumes={volumes} onChanged={refresh} />

      {adding && (
        <AddTarget
          backends={backends}
          providers={providers}
          unlisted={unlisted}
          taken={remotes.map((r) => r.name)}
          onDone={(saved) => {
            setAdding(false)
            if (saved) refresh()
          }}
        />
      )}
      {registering && (
        <DriveForm
          onDone={(saved) => {
            setRegistering(false)
            if (saved) refresh()
          }}
        />
      )}

      <PageActions>
        <PageAction
          label={t('targets.registerDrive')}
          labelKey="targets.registerDrive"
          glyph={<IconAdd />}
          onClick={() => setRegistering(true)}
        />
        <span data-new="provider-names" className="flex">
          <PageAction
            primary
            label={t('targets.addStorage')}
            labelKey="targets.addStorage"
            glyph={<IconAdd />}
            onClick={() => setAdding(true)}
          />
        </span>
      </PageActions>
    </Stack>
  )
}

const GROUPS = ['cloud', 'storage', 'protocol'] as const

type Group = (typeof GROUPS)[number]

/** Each card's title and empty line, so the three never read alike. */
const TEXT = {
  cloud: { title: 'targets.cloud', empty: 'targets.cloudEmpty' },
  storage: { title: 'targets.storage', empty: 'targets.bucketEmpty' },
  protocol: { title: 'targets.connections', empty: 'targets.serverEmpty' },
} as const

function Storage({
  group,
  hueIndex,
  rows,
  marked,
  backends,
  providers,
  onChanged,
}: {
  group: Group
  hueIndex: number
  rows: Remote[]
  /** Carries the What's new mark on its first row, being the first card with any. */
  marked: boolean
  backends: Backend[]
  /** The providers of this card's group, which name a target's product. */
  providers: Provider[]
  onChanged: () => void
}) {
  const { t } = useT()
  const [editing, setEditing] = useState<Remote | null>(null)

  return (
    <Card title={t(TEXT[group].title)} hueIndex={hueIndex}>
      {rows.length === 0 ? (
        <Empty>{t(TEXT[group].empty)}</Empty>
      ) : (
        <Rows className="-mx-2 flex flex-col">
          {rows.map((r, i) => (
            <RemoteRow
              key={r.name}
              remote={r}
              newId={marked && i === 0 ? 'target-rows' : undefined}
              onEdit={() => setEditing(r)}
              onChanged={onChanged}
            />
          ))}
        </Rows>
      )}
      {editing && (
        <RemoteForm
          title={t('targets.editTitle', { name: editing.name })}
          backends={backends}
          existing={editing}
          // The engine identifies the product from the target's settings
          // (internal/remotes/identify.go).
          provider={providers.find((x) => x.id === editing.provider) ?? null}
          onDone={(saved) => {
            setEditing(null)
            if (saved) onChanged()
          }}
        />
      )}
    </Card>
  )
}

/**
 * Adding picks a product first, then shows that backend's fields in the same
 * window, so nobody has to know Nextcloud is "webdav". The products stand in
 * their three groups under a search that narrows all of them at once, and
 * Back returns to them.
 */
function AddTarget({
  backends,
  providers,
  unlisted,
  taken,
  onDone,
}: {
  backends: Backend[]
  providers: Provider[]
  unlisted: Backend[]
  taken: string[]
  onDone: (saved: boolean) => void
}) {
  const { t } = useT()
  const [picked, setPicked] = useState<{ kind: string; provider: Provider | null } | null>(null)
  const [query, setQuery] = useState('')

  // While a query narrows the tiles the window keeps the height it opened
  // with, or the search would move away from the eye with every letter.
  const body = useRef<HTMLDivElement>(null)
  const [floor, setFloor] = useState<number>()
  useLayoutEffect(() => {
    const scroller = body.current?.parentElement
    if (!scroller || floor !== undefined) return
    const style = getComputedStyle(scroller)
    setFloor(scroller.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom))
  }, [picked, floor])

  if (picked) {
    return (
      <RemoteForm
        title={t('targets.addStorage')}
        backends={backends}
        kind={picked.kind}
        provider={picked.provider}
        taken={taken}
        onBack={() => setPicked(null)}
        onDone={onDone}
      />
    )
  }

  // By the name shown and by rclone's own, which is what a guide online calls it.
  const groups = GROUPS.map((group) => ({
    group,
    providers: providers.filter((p) => p.group === group && matchesQuery(query, [providerName(p, t), p.name, p.backend])),
    // An rclone backend with no provider entry counts as a protocol here.
    unlisted: group === 'protocol' ? unlisted.filter((b) => matchesQuery(query, [b.name])) : [],
  })).filter((g) => g.providers.length + g.unlisted.length > 0)
  const tile = (id: string, fallback: string) => {
    const p = providers.find((x) => x.id === id)
    return p ? providerName(p, t) : fallback
  }

  return (
    <Dialog
      title={t('targets.addStorage')}
      hint={t('targets.addStorageHint')}
      onClose={() => onDone(false)}
      wide
      search={<PickerSearch value={query} onChange={setQuery} label={t('targets.search')} />}
    >
      <div ref={body} className="flex flex-col gap-6" style={{ minHeight: floor }}>
        {groups.length === 0 ? (
          <p className="py-6 text-center text-subline text-carbon-textMuted">
            {t('targets.searchNone', { query: query.trim(), s3: tile('s3', 'S3'), webdav: tile('webdav', 'WebDAV') })}
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.group} className="flex flex-col gap-3">
              <h3 className="glim-eyebrow">{t(TEXT[g.group].title)}</h3>
              <ProviderPicker
                providers={g.providers}
                unlisted={g.unlisted}
                onPick={(choice) =>
                  setPicked(typeof choice === 'string' ? { kind: choice, provider: null } : { kind: choice.backend, provider: choice })
                }
              />
            </section>
          ))
        )}
      </div>
    </Dialog>
  )
}

/**
 * One target as one row: its brand in the tile, its name, and what else it
 * could say in the bubble beside the name. Edit and Delete come in under the
 * pointer; the test button stays once it has a verdict, which it carries in
 * its colour, word and glyph, with the reason on a line under the name.
 */
function RemoteRow({
  remote,
  newId,
  onEdit,
  onChanged,
}: {
  remote: Remote
  newId?: string
  onEdit: () => void
  onChanged: () => void
}) {
  const { t, lang } = useT()
  const push = useToast()
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<CheckAnswer | null>(null)
  // A failed test somebody pressed shakes the button; the one on opening does
  // not, or every unreachable row would shake as the page appears.
  const [refused, setRefused] = useState(0)
  const checkButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (refused) replay(checkButton.current, 'glim-shake')
  }, [refused])
  // How full the target is, fetched on the same press once the check has
  // succeeded.
  const [usage, setUsage] = useState<Usage | null>(null)
  // Deleting a target takes its credentials, which nothing here can restore.
  const [confirming, setConfirming] = useState(false)

  async function check(asked = false) {
    setChecking(true)
    setResult(null)
    setUsage(null)
    try {
      const answer = await api.checkRemote(remote.name)
      setResult(answer)
      if (!answer.ok && asked) setRefused((n) => n + 1)
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
      if (asked) setRefused((n) => n + 1)
    } finally {
      setChecking(false)
    }
  }

  // A folder on this device has nothing to connect to, so only a target
  // elsewhere says whether it is connected, and does so as soon as it shows.
  const local = isLocalTarget(remote)
  useEffect(() => {
    if (!local) void check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote.name, local])

  // Enough settings to tell two targets apart; secrets never leave the engine.
  const summary = remote.settings
    .filter((s) => !s.secret && s.value)
    .slice(0, 3)
    .map((s) => `${s.key}=${s.value}`)
    .join(', ')
  const facts = [remote.mark ? '' : remote.type, summary, usage ? space(usage, t) : ''].filter(Boolean)
  const why = result && !result.ok && result.reason ? failureLine(result.reason, result.failure, t, lang) : ''

  return (
    <li className="glim-row flex min-h-14 items-center gap-3 rounded-control px-2 py-2 hover:bg-carbon-hover">
      {/* The engine identifies the product and its mark from the saved
          settings (internal/remotes/identify.go). */}
      <span className="glim-row-glyph flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-[20px]">
        {(remote.mark && brandMark(remote.mark)) || <IconTabStorage />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-body font-medium">{remote.name}:</span>
          {facts.length > 0 && <InfoBubble tip={facts.join(' · ')} />}
        </span>
        {why && <span className="text-subline text-statusFail [overflow-wrap:anywhere]">{why}</span>}
      </span>
      <span className="glim-row-actions flex shrink-0 items-center gap-1.5">
        <IconAction onClick={onEdit} title={t('action.edit')} labelKey="action.edit">
          <IconPencil />
        </IconAction>
        <IconAction title={t('action.delete')} labelKey="action.delete" onClick={() => setConfirming(true)}>
          <IconTrash />
        </IconAction>
      </span>
      <span data-new={newId} className={`${result || checking ? '' : 'glim-row-actions '}glim-row-verdict flex shrink-0`}>
        <Button
          ref={checkButton}
          label={
            checking ? t('targets.checking') : !result ? t('targets.check') : result.ok ? t('targets.checkOk') : t('targets.checkFailed')
          }
          labelKey="targets.check"
          glyph={checking || !result ? undefined : result.ok ? <IconCheck /> : <IconClose />}
          tone={checking || !result ? 'neutral' : result.ok ? 'ok' : 'danger'}
          title={why || t('targets.checkHint')}
          busy={checking}
          onClick={() => void check(true)}
          disabled={checking}
        />
      </span>

      {confirming && (
        <ConfirmDialog
          title={t('confirm.deleteRemote')}
          message={t('confirm.deleteRemoteStakes', { name: remote.name })}
          confirmLabel={t('confirm.delete')}
          confirmGlyph={<IconTrash />}
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            api
              .deleteRemote(remote.name)
              .then(onChanged)
              .catch((e: Error) => push(errorText(t, e), 'fail'))
          }}
        />
      )}
    </li>
  )
}

/**
 * How full a target is, in words, as far as the target said. A bucket store
 * with no quota says nothing rather than a figure at zero.
 */
function space(usage: Usage, t: ReturnType<typeof useT>['t']): string {
  if (!usage.supported) return ''
  const total = usage.total
  const used = usage.used ?? (total !== undefined && usage.free !== undefined ? total - usage.free : undefined)
  if (usage.free !== undefined && total !== undefined) return t('targets.spaceFree', { free: bytes(usage.free), total: bytes(total) })
  if (used !== undefined) return t('targets.spaceUsed', { used: bytes(used) })
  if (total !== undefined) return t('targets.spaceTotal', { total: bytes(total) })
  return ''
}

/**
 * The form for one target in a window, built from the option metadata rclone
 * carries for each backend, so it stays right as backends gain options. The
 * questions most targets need come first; every other setting stands below
 * them in a sub-card of its own.
 */
function RemoteForm({
  title,
  backends,
  kind: chosen,
  provider,
  taken,
  existing,
  onBack,
  onDone,
}: {
  title: string
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
  /** Returns to the picker the form was opened from, in place of Cancel. */
  onBack?: () => void
  onDone: (saved: boolean) => void
}) {
  const { t, lang } = useT()
  const push = useToast()
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
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [trying, setTrying] = useState(false)
  /** The result of a test run before saving. */
  const [tried, setTried] = useState<CheckAnswer | null>(null)
  // Count failed tests and saves, so each one remounts its button and shakes it again.
  const [refused, setRefused] = useState(0)
  const [unsaved, setUnsaved] = useState(0)

  const backend = useMemo(() => backends.find((b) => b.name === kind), [backends, kind])
  // rclone's required and essential options first; s3 alone has fourteen
  // others. A setting the chosen product already presets (the WebDAV vendor
  // for Nextcloud) is no question, so it waits with the rest.
  const [first, rest] = useMemo(() => {
    const options = backend?.options ?? []
    const main = options.filter((o) => (o.required || o.essential) && (!preset || preset[o.name] === undefined))
    return [main, options.filter((o) => !main.includes(o))]
  }, [backend, preset])

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
      const answer = await api.tryRemote(kind, { ...(preset ?? {}), ...filled }, existing?.name)
      setTried(answer)
      if (!answer.ok) setRefused((n) => n + 1)
    } catch (e) {
      setTried({ ok: false, reason: (e as Error).message })
      setRefused((n) => n + 1)
    } finally {
      setTrying(false)
    }
  }

  async function save() {
    setBusy(true)
    try {
      // An empty field clears its setting, so only filled fields and existing
      // settings are sent, not every untouched option.
      const filled = Object.fromEntries(
        Object.entries(values).filter(([key, value]) => value !== '' || existing?.settings.some((s) => s.key === key)),
      )
      const saved = name.trim()
      await api.saveRemote(saved, kind, filled, !existing)
      // Checked after saving, so a typo shows at once rather than as a failed
      // run. The answer never blocks, since the server may simply be off.
      setBusy(false)
      setChecking(true)
      try {
        const answer = await api.checkRemote(saved)
        if (!answer.ok) push(t('targets.savedButUnreachable', { reason: answer.reason ?? '' }), 'fail')
      } catch {
        // A check that could not run says nothing about the target.
      } finally {
        setChecking(false)
      }
      onDone(true)
    } catch (e) {
      push((e as Error).message, 'fail')
      setUnsaved((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  // A stored secret arrives as the placeholder and goes back untouched unless
  // it is changed, which tells the engine to keep it (remotes.Save).
  const field = (o: Backend['options'][number]) =>
    o.secret ? (
      <SecretRow
        key={o.name}
        label={optionLabel(o.name, t)}
        hint={optionHint(o, t, provider)}
        value={values[o.name] ?? ''}
        onChange={(next) => setValues((prev) => ({ ...prev, [o.name]: next }))}
        placeholder={o.default}
        stacked
      />
    ) : (
      <Field key={o.name} label={optionLabel(o.name, t)} hint={optionHint(o, t, provider)}>
        {kind === 'smb' && o.name === 'host' ? (
          <ShareHost
            value={values.host ?? ''}
            onChange={(next) => setValues((prev) => ({ ...prev, host: next }))}
            placeholder={o.default || o.examples?.[0]?.value}
            // The account comes along where the field is still empty; the
            // password cannot be read back from Windows.
            onShare={(picked) =>
              setValues((prev) => ({
                ...prev,
                host: picked.host,
                ...(picked.user && !prev.user ? { user: picked.user } : {}),
                ...(picked.domain && !prev.domain ? { domain: picked.domain } : {}),
              }))
            }
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
    )

  return (
    <Dialog
      title={title}
      onClose={() => onDone(false)}
      closeOnBackdrop={false}
      footer={
        <>
          {onBack ? (
            <Button label={t('preview.back')} labelKey="preview.back" glyph={<IconBack />} onClick={onBack} />
          ) : (
            <Button label={t('targets.cancel')} labelKey="targets.cancel" glyph={<IconClose />} onClick={() => onDone(false)} />
          )}
          {/* Tests before anything is written; saving checks again afterwards.
              Colour, word and glyph all carry the last verdict, so colour is
              never the only signal. */}
          <Button
            key={`try-${refused}`}
            label={
              trying ? t('targets.checking') : !tried ? t('targets.check') : tried.ok ? t('targets.checkOk') : t('targets.checkFailed')
            }
            labelKey="targets.check"
            glyph={trying || !tried ? undefined : tried.ok ? <IconCheck /> : <IconClose />}
            tone={trying || !tried ? 'neutral' : tried.ok ? 'ok' : 'danger'}
            title={tried && !tried.ok && tried.reason ? failureLine(tried.reason, tried.failure, t, lang) : undefined}
            className={tried && !tried.ok && !trying ? 'glim-shake' : ''}
            busy={trying}
            stage={groupStage([t('targets.check'), t('targets.checking'), t('targets.checkOk'), t('targets.checkFailed')])}
            onClick={() => void tryIt()}
            disabled={busy || trying || !kind}
          />
          <Button
            key={`save-${unsaved}`}
            label={checking ? t('targets.checking') : t('targets.save')}
            labelKey={checking ? 'targets.checking' : 'targets.save'}
            glyph={<IconSave />}
            tone="accent"
            className={unsaved > 0 ? 'glim-shake' : ''}
            onClick={() => void save()}
            disabled={busy || checking || !name.trim() || !kind}
          />
        </>
      }
    >
      <div className="flex flex-col gap-4 py-2">
        {/* An OAuth token needs a browser at the provider's sign-in page on the
            engine's machine, which this interface cannot open, so the form
            names the command that produces one. */}
        {backend?.needsToken && (
          <p className="flex items-start gap-2 text-subline text-carbon-textMuted">
            <InfoBubble tip={t('targets.tokenHowTo')} />
            <span>{t('targets.tokenNeeded', { backend: backend.name })}</span>
          </p>
        )}
        {/* No backend type on screen: the picker already chose it in terms of
            products. */}
        <Field label={t('targets.remoteName')} hint={t('targets.remoteNameHint')}>
          {/* Fixed once saved: the jobs that use the target name it, and its
              secrets never reach this form to be written under a new name. */}
          <Text value={name} onChange={setName} placeholder="backup" mono readOnly={!!existing} />
        </Field>
        {first.map(field)}
        {rest.length > 0 && (
          <section className="glim-well flex flex-col gap-4 rounded-card p-4">
            <h3 className="glim-eyebrow">{t('targets.moreSettings')}</h3>
            {rest.map(field)}
          </section>
        )}
      </div>
    </Dialog>
  )
}

/**
 * The server field of a share, with a button that lists the shares this
 * computer is already connected to, such as a drive mapped in Explorer. Only a
 * Windows machine reports any; elsewhere the list says there are none.
 */
function ShareHost({
  value,
  onChange,
  placeholder,
  onShare,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  onShare: (picked: Share) => void
}) {
  const { t } = useT()
  const row = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [shares, setShares] = useState<Share[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Asked on every opening, since a share can be connected while the form is open.
  function toggle() {
    if (open) return setOpen(false)
    setOpen(true)
    setShares(null)
    setError(null)
    api
      .shares()
      .then((got) => setShares(got.shares))
      .catch((e: Error) => setError(e.message))
  }

  return (
    <div ref={row} className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <Text value={value} onChange={onChange} placeholder={placeholder} mono />
      </div>
      <IconAction
        title={t('targets.pickShare')}
        labelKey="targets.pickShare"
        hint={t('targets.pickShareHint')}
        onClick={toggle}
      />
      <DropdownListbox open={open} onClose={() => setOpen(false)} triggerRef={row} label={t('targets.pickShare')}>
        {error ? (
          <p className="px-3 py-2 text-subline text-statusFail">{error}</p>
        ) : !shares ? (
          <p className="px-3 py-2 text-subline text-carbon-textMuted">{t('pick.loading')}</p>
        ) : shares.length === 0 ? (
          <p className="px-3 py-2 text-subline text-carbon-textMuted">{t('targets.noShares')}</p>
        ) : (
          shares.map((sh) => (
            <button
              key={sh.path}
              type="button"
              role="option"
              aria-selected={sh.host === value}
              onClick={() => {
                onShare(sh)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-start text-meta text-carbon-textSub transition-colors hover:bg-carbon-hover hover:text-carbon-text"
            >
              <span className="shrink-0 text-carbon-textMuted" aria-hidden>
                <IconFolder />
              </span>
              {sh.letter && <span className="shrink-0 font-medium text-carbon-text">{sh.letter}</span>}
              <span className="min-w-0 truncate font-mono" title={sh.path}>
                {sh.path}
              </span>
            </button>
          ))
        )}
      </DropdownListbox>
    </div>
  )
}

function Drives({ volumes, onChanged }: { volumes: Volume[]; onChanged: () => void }) {
  const { t } = useT()
  return (
    <Card title={t('targets.drives')} hint={t('targets.driveExplain')} hueIndex={3}>
      {volumes.length === 0 ? (
        <Empty>{t('targets.drivesEmpty')}</Empty>
      ) : (
        <Rows className="-mx-2 flex flex-col">
          {volumes.map((v) => (
            <DriveRow key={v.id} volume={v} onChanged={onChanged} />
          ))}
        </Rows>
      )}
    </Card>
  )
}

function DriveRow({ volume, onChanged }: { volume: Volume; onChanged: () => void }) {
  const { t } = useT()
  const push = useToast()
  const [copied, setCopied] = useState(false)
  const copyButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (copied) replay(copyButton.current, 'glim-confirm')
  }, [copied])
  // Asks first, since deleting removes the identity file from the volume itself.
  const [confirming, setConfirming] = useState(false)

  return (
    <li className="glim-row flex min-h-14 items-center gap-3 rounded-control px-2 py-2 hover:bg-carbon-hover">
      <span className="glim-row-glyph flex h-9 w-9 shrink-0 items-center justify-center rounded-control">
        <IconTabStorage />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-body font-medium">{volume.label}</span>
        <InfoBubble tip={volume.attached ? volume.mount : volume.path} />
      </span>
      <span className="glim-row-actions flex shrink-0 items-center gap-1.5">
        <IconAction
          ref={copyButton}
          title={copied ? t('targets.copied') : t('targets.copyPath')}
          labelKey={copied ? 'targets.copied' : 'targets.copyPath'}
          onClick={() => {
            void navigator.clipboard?.writeText(volume.path).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? <IconCheckDraw className="glim-check-draw" /> : <IconCopy />}
        </IconAction>
        <IconAction
          title={t('targets.deleteDrive')}
          labelKey="targets.deleteDrive"
          hint={t('targets.deleteDriveHint')}
          onClick={() => setConfirming(true)}
        >
          <IconTrash />
        </IconAction>
      </span>
      {!volume.attached && volume.lastSeen && (
        <span className="shrink-0 text-subline text-carbon-textMuted max-sm:hidden">
          {t('targets.lastSeen')}: <Since when={volume.lastSeen} />
        </span>
      )}
      {/* Not the accent: an attached drive is a state, not activity. */}
      <Badge tone={volume.attached ? 'ok' : 'neutral'}>{volume.attached ? t('targets.attached') : t('targets.absent')}</Badge>

      {confirming && (
        <ConfirmDialog
          title={t('confirm.deleteDrive')}
          message={t('confirm.deleteDriveStakes', { name: volume.label })}
          confirmLabel={t('confirm.delete')}
          confirmGlyph={<IconTrash />}
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            api
              .forgetVolume(volume.id)
              .then(onChanged)
              .catch((e: Error) => push(e.message, 'fail'))
          }}
        />
      )}
    </li>
  )
}

/** Registering a drive, in a window: which one, and what to call it. */
function DriveForm({ onDone }: { onDone: (saved: boolean) => void }) {
  const { t } = useT()
  const push = useToast()
  const [candidates, setCandidates] = useState<DriveCandidate[] | null>(null)
  const [mount, setMount] = useState('')
  const [label, setLabel] = useState('')
  // The drive's own name fills the field until somebody types one.
  const [typed, setTyped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(0)

  useEffect(() => {
    api
      .volumeCandidates()
      .then((c) => {
        const fresh = c.candidates.filter((x) => !x.marked)
        setCandidates(fresh)
        setMount((current) => current || fresh[0]?.mount || '')
        setLabel((current) => current || fresh[0]?.name || '')
      })
      .catch((e: Error) => {
        setCandidates([])
        push(e.message, 'fail')
      })
  }, [push])

  async function save() {
    setBusy(true)
    try {
      await api.markVolume(mount, label.trim())
      onDone(true)
    } catch (e) {
      push((e as Error).message, 'fail')
      setRefused((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  const none = candidates !== null && candidates.length === 0
  return (
    <Dialog
      title={t('targets.registerDrive')}
      hint={t('targets.driveExplain')}
      onClose={() => onDone(false)}
      closeOnBackdrop={false}
      footer={
        <>
          <Button label={t('targets.cancel')} labelKey="targets.cancel" glyph={<IconClose />} onClick={() => onDone(false)} />
          {!none && (
            <Button
              key={refused}
              label={t('targets.save')}
              labelKey="targets.save"
              glyph={<IconSave />}
              tone="accent"
              className={refused > 0 ? 'glim-shake' : ''}
              onClick={() => void save()}
              disabled={busy || !mount}
            />
          )}
        </>
      }
    >
      {candidates === null ? (
        <Empty>{t('pick.loading')}</Empty>
      ) : none ? (
        <Empty>{t('targets.noCandidates')}</Empty>
      ) : (
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <Field label={t('targets.driveMount')}>
            <Choice
              value={mount}
              onChange={(next) => {
                setMount(next)
                if (!typed) setLabel(candidates.find((c) => c.mount === next)?.name ?? '')
              }}
              label={t('targets.driveMount')}
              options={candidates.map((c) => ({ value: c.mount, label: c.name ? `${c.mount} · ${c.name}` : c.mount }))}
            />
          </Field>
          <Field label={t('targets.driveLabel')} hint={t('targets.driveLabelHint')}>
            <Text
              value={label}
              onChange={(next) => {
                setLabel(next)
                setTyped(true)
              }}
              placeholder="Backup drive"
            />
          </Field>
        </div>
      )}
    </Dialog>
  )
}
