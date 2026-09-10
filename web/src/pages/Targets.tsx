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
import { Choice, Field, Secret, Text } from '../components/Field'
import { ToggleRow } from '../components/ToggleRow'
import { api, type Backend, type Provider, type Remote, type Usage, type Volume } from '../lib/api'
import { bytes } from '../lib/bytes'
import { useT } from '../lib/i18n'
import { hasOptionLabel, optionExplain, optionLabel } from '../lib/optionNames'
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
      {/* Two cards, and the line between them is what somebody HAS: an
          account with a company, or a machine and an address. That puts
          Backblaze with the clouds although it speaks S3, and plain S3 with the
          protocols although it is Amazon's - which is right, because the
          question being answered is "what am I connecting to", not "which
          protocol does it use". */}
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
        group="protocol"
        title={t('targets.connections')}
        hueIndex={1}
        remotes={remotes}
        backends={backends}
        providers={providers}
        /* The unlisted backends belong here rather than under the clouds: an
           rclone type nobody has named is a protocol as far as this screen is
           concerned. */
        unlisted={unlisted}
        onChanged={refresh}
      />
      <Drives volumes={volumes} onChanged={refresh} />
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

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
  /** Which half of the providers this card offers. */
  group: 'cloud' | 'protocol'
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
  /**
   * Adding is TWO steps now: pick what you are connecting to, then fill in
   * that thing's own fields. Null is closed, 'pick' is the list, and a string
   * is the chosen backend.
   *
   * Two steps rather than one form with a type dropdown, because the dropdown
   * asked somebody to know that Nextcloud is "webdav" before they could set up
   * their Nextcloud.
   */
  const [adding, setAdding] = useState<null | 'pick' | string>(null)
  const [provider, setProvider] = useState<Provider | null>(null)

  const mine = useMemo(() => providers.filter((p) => p.group === group), [providers, group])

  // Which existing targets belong on THIS card, by the backend their provider
  // resolves to. A target whose backend no provider on either card claims shows
  // on the protocol card, where the unlisted backends are.
  const cloudBackends = useMemo(
    () => new Set(providers.filter((p) => p.group === 'cloud').map((p) => p.backend)),
    [providers],
  )
  const rows = useMemo(
    () => remotes.filter((r) => (group === 'cloud' ? cloudBackends.has(r.type) : !cloudBackends.has(r.type))),
    [remotes, group, cloudBackends],
  )

  return (
    <Card title={title} hueIndex={hueIndex}>
      {/* The card's own control, at the top of its body. GlimStone's Card draws
          a heading and nothing else, so a card's controls live in the body.

          `accent`, and the card carries a position: without both, this button
          painted the flat neutral grey the colour engine cannot reach while
          every card on the settings page beside it answered the setting. jdp:
          "Speichercard: der button ist auch nicht mehr in den enigens." */}
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
   * This row's place in the list, which is what its actions colour themselves
   * from.
   *
   * The buttons take FIXED offsets off it rather than a running count, the same
   * way the job card's row does and for the same reason: a button keeps its
   * colour when a neighbour is not rendered.
   */
  row: number
  onEdit: () => void
  onChanged: () => void
}) {
  const { t } = useT()
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; reason?: string } | null>(null)
  /**
   * How full this target is, fetched alongside the check.
   *
   * On the SAME press rather than on a button of its own: the check already
   * opens a connection, and a second control that opens another one asks
   * somebody to press twice for two halves of "is this target all right".
   *
   * Fetched only after the check SUCCEEDS. Asking a target that just refused
   * the connection how much room it has produces a second copy of the same
   * refusal, one line below the first.
   */
  const [usage, setUsage] = useState<Usage | null>(null)
  // Deleting a target takes its credentials with it, and nothing here can put
  // them back, so this one asks. Forgetting a drive does not: the marker stays
  // on the disk and plugging it in brings it straight back.
  const [confirming, setConfirming] = useState(false)

  async function check() {
    setChecking(true)
    setResult(null)
    setUsage(null)
    try {
      const answer = await api.checkRemote(remote.name)
      setResult(answer)
      if (answer.ok) {
        // Its own failure is silent. Space is the extra a working target can
        // offer, and a target that answered the check is fine whether or not
        // it also cares to say how full it is.
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
          <span className="truncate text-sm font-medium">{remote.name}:</span>
          <Badge>{remote.type}</Badge>
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
        {/* The one thing somebody came to this row to do stays visible; the
            rest arrive when the pointer does.

            The explanation rides ON the button rather than beside it as its own
            (i). A bubble belongs next to a control's LABEL, and a row of
            icon-only buttons has no labels, so a lone (i) among them reads as a
            fourth button with a mystery behind it. An icon-only button already
            has to carry a tip to be nameable at all, so the sentence goes
            there, where a pointer heading for the button finds it. */}
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
          <IconAction onClick={onEdit} title={t('targets.edit')} labelKey="targets.edit" hueIndex={row + 2}>
            <IconEdit />
          </IconAction>
          <IconAction
            title={t('targets.delete')}
            labelKey="targets.delete"
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
 * How full a target is, drawn only as far as the target actually said.
 *
 * jdp asked for the space per target, and the interesting part is what happens
 * when there ISN'T one. Most cloud targets cannot answer: a bucket store has no
 * quota to report and will take another terabyte, so `supported` comes back
 * false and this draws nothing at all rather than a bar at zero. A bar at zero
 * on a healthy bucket reads as a disk about to fill up, which is the opposite
 * of the truth.
 *
 * The bar needs BOTH a total and a used figure, and some backends give one
 * without the other. With only half of the pair the figure is still worth
 * saying, so the words appear without the bar.
 *
 * The colour is a real warning rather than decoration: past nine tenths, a sync
 * that would have worked last week is about to stop halfway and leave two sides
 * in a state nobody chose.
 */
function Space({ usage }: { usage: Usage }) {
  const { t } = useT()
  if (!usage.supported) return null

  const total = usage.total
  // Used, or worked out from the pair - a target that reports free and total
  // has said what is used without spelling it out.
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
  kind: chosen,
  provider,
  taken,
  existing,
  onDone,
}: {
  backends: Backend[]
  /**
   * The backend, decided BEFORE this form opens.
   *
   * It used to be a dropdown at the top, which is what made the screen ask for
   * an implementation detail: somebody setting up their Nextcloud had to know
   * it is "webdav" first. The picker answers that question in the language of
   * products, and this form only ever shows one backend's fields.
   */
  kind?: string
  /**
   * The whole provider that was picked, where one was.
   *
   * It carries three things this form cannot work out for itself: what it
   * fills in without asking (the WebDAV vendor, say), what the target should
   * be CALLED, and what this product's address looks like. An unlisted backend
   * has no provider entry and arrives as null.
   */
  provider?: Provider | null
  /** The names already in use, so a suggested one does not collide. */
  taken?: string[]
  existing?: Remote
  onDone: (saved: boolean) => void
}) {
  const { t } = useT()
  const preset = provider?.preset
  /**
   * The name, suggested rather than demanded.
   *
   * jdp: "Bitte den Namen schon vorausgefüllt eintragen." Somebody who just
   * pressed Nextcloud has already said what this is, and asking them to type it
   * again is asking twice. The suggestion is the product's name folded into
   * what a target name may hold - no spaces, no colons, because the name is
   * written as `name:path` in a job - and numbered where one is already taken,
   * so pressing Nextcloud twice gives `nextcloud` and `nextcloud-2` rather than
   * a collision on save.
   */
  const [name, setName] = useState(() => {
    if (existing) return existing.name
    if (!provider) return ''
    const base = provider.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!base) return ''
    const used = new Set(taken ?? [])
    if (!used.has(base)) return base
    for (let n = 2; n < 100; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`
    return base
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

  const backend = useMemo(() => backends.find((b) => b.name === kind), [backends, kind])
  /**
   * What the form shows before anybody asks for more.
   *
   * REQUIRED only, which is a much shorter list than it used to be. The filter
   * was "everything rclone does not mark advanced", and for s3 that is fourteen
   * boxes, most of them for one provider out of thirty: the form asked about
   * IBM resource instances and object-lock before it asked for a key. Reported
   * as exactly that ("für was müssen hier so wahnsinnig viele eingabefelder
   * sein?").
   *
   * Nothing is hidden that was reachable before: the switch below still shows
   * every option the backend has, advanced ones included. What changed is which
   * side of it the merely-optional ones sit on. rclone's own `required` flag is
   * the line, so it moves with the backend rather than with a list here that
   * would go stale the first time rclone gained an option.
   */
  const shown = useMemo(
    () =>
      (backend?.options ?? [])
        .filter((o) => advanced || o.required || o.essential)
        // A setting the PRODUCT already answered is not a question. jdp, about
        // the WebDAV vendor on a form he reached by pressing Nextcloud: "für was
        // gibt es das Feld Servertyp?" For exactly nothing there - it is the
        // answer to "which WebDAV dialect", and choosing Nextcloud WAS that
        // answer. It still appears on plain WebDAV, where nobody has answered it,
        // and behind the advanced switch, where somebody is looking for it.
        .filter((o) => advanced || !preset || preset[o.name] === undefined),
    [backend, advanced, preset],
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
      const saved = name.trim()
      await api.saveRemote(saved, kind, filled)
      // Saved, and now ASKED. Saving a target proves nothing: a typo in the
      // address or a password with a trailing space is written to the file just
      // as happily as a working one, and the first anybody hears of it is a
      // failed run at three in the morning. The check exists and nothing was
      // calling it.
      //
      // Its answer is shown but never blocks: the target is already saved, and
      // a person setting up a server that is switched off right now has done
      // nothing wrong. So this reports, and closing the form is still their
      // decision.
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
        // The check itself could not be run. That says nothing about the
        // target, so it says nothing at all rather than accusing it.
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
      {/* Said before the form rather than after it fails. These backends are
          reached with an OAuth token and nothing else, and obtaining one needs
          a browser sitting at the provider's own sign-in page - which this
          interface has no way to open on the machine the engine runs on. So
          the honest thing is to name the one command that produces it, at the
          moment somebody picks the backend. */}
      {backend?.needsToken && (
        <p className="flex items-start gap-2 text-xs text-carbon-textMuted">
          <InfoBubble tip={t('targets.tokenHowTo')} />
          <span>{t('targets.tokenNeeded', { backend: backend.name })}</span>
        </p>
      )}
      {/* No type field at all, neither a dropdown nor a read-only line.
          It showed `webdav` under a heading called Type, on a form somebody
          reached by pressing Nextcloud - naming the implementation of the thing
          they had just chosen, which is the exact knowledge the picker exists
          to stop asking for. jdp: "Für was brauchen wir die Art bei den
          Clouds?" The chosen backend is still what gets saved; it simply has
          nothing left to say on screen.

          One column, centred, because that is what the fields are: a short
          stack of questions, not a form to be filled in two directions at
          once. */}
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <Field label={t('targets.remoteName')} hint={t('targets.remoteNameHint')}>
          <Text value={name} onChange={setName} placeholder="backup" mono />
        </Field>

        {shown.map((o) => (
          <Field
            key={o.name}
            label={optionLabel(o.name, t)}
            /* rclone's own name under the translated one, but only where the
               two differ: repeating "host" under "host" is noise. Somebody
               following rclone's documentation still finds the field. */
            hint={optionHint(o, t, provider)}
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

        <ToggleRow checked={advanced} onChange={setAdvanced} label={t('targets.advanced')} />

        {error && <p className="text-xs text-statusFail">{error}</p>}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button label={t('targets.cancel')} labelKey="targets.cancel" onClick={() => onDone(false)} />
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

/**
 * What the bubble beside one field says, and whether there is a bubble at all.
 *
 * Three sources, in order of how much they are worth:
 *
 *  1. This app's own explanation, translated, for the fields where there is
 *     something to explain. An address needs its shape; a password is better
 *     as an app password.
 *  2. The chosen PRODUCT's own address shape, appended to the address field.
 *     Three products share the WebDAV backend and each has its own path, and
 *     rclone's "URL of http host to connect to" helps nobody looking at their
 *     Nextcloud in a tab wondering which part to copy.
 *  3. rclone's own help, for everything else.
 *
 * And nothing at all where rclone's help merely restates the label. That is
 * what it did on almost every field - "user - User name." under a label
 * reading Benutzername - and a bubble that repeats its own label is worse than
 * no bubble: it promises an explanation and spends attention on nothing.
 */
function optionHint(
  o: Backend['options'][number],
  t: ReturnType<typeof useT>['t'],
  provider?: Provider | null,
): string | undefined {
  const own = optionExplain(o.name, t)
  const shape = o.name === 'url' ? provider?.urlHint : undefined
  if (own || shape) return [own, shape].filter(Boolean).join(' ')
  // No explanation of our own: rclone's, but only when it says more than the
  // label already does. Its own option name comes along there, because
  // somebody reading rclone's documentation is the one this text is for.
  if (!o.help) return undefined
  if (hasOptionLabel(o.name) && sameAsLabel(o.name, o.help)) return undefined
  return hasOptionLabel(o.name) ? `${o.name} - ${o.help}` : o.help
}

/**
 * Whether rclone's help for an option says anything its own name does not.
 *
 * Compared on the rclone NAME rather than on the translated label, because the
 * help is always English and the label is not: "user" against "User name."
 * matches in every language, "user" against "Benutzername" in none.
 */
function sameAsLabel(name: string, help: string): boolean {
  const flat = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const body = flat(help)
  const own = flat(name)
  // "User name." for `user`, "Password." for `pass`: the help is the name with
  // a word of padding at most.
  return body.length <= own.length + 6 && (body.startsWith(own) || body.includes(own))
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
      hueIndex={1}
    >
      {/* Same as the storage card above it, reported in the same breath:
          "Datentraeger-card: der button ist nicht in den enigens." */}
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
  /** This row's place in the list. Same rule as RemoteRow's. */
  row: number
  onChanged: () => void
}) {
  const { t } = useT()
  const [copied, setCopied] = useState(false)
  // Asked before, because this reaches onto the disk: the identity file is
  // removed from the volume itself, not merely from a list here.
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="group flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{volume.label}</span>
          {/* Attached is a state and states are badges. It is deliberately not
              the accent: a list of drives sitting there is not activity. */}
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
        {/* NOT inside RowActions, which reveals on hover. A drive's one
            destructive action was reachable only by finding it with the
            pointer, and it is the thing somebody comes to this row to do.
            jdp: "der vergessen button wird nur bei mouseover angezeigt."

            And it says DELETE now. It used to say "forget", which described
            the old behaviour honestly - the register entry went and the marker
            stayed - and that behaviour was the bug: the drive came straight
            back. Now it removes both, so the word that fits is the plain one. */}
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
