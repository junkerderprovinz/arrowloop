import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { Dialog } from '../../components/Dialog'
import { FieldRow, Secret, Text } from '../../components/Field'
import { IconAdd, IconCheck, IconClose } from '../../components/glyphs'
import { PickTiles } from '../../components/PickTiles'
import { PickerWindow } from '../../components/PickerWindow'
import { api, ApiError } from '../../lib/api'
import { at } from '../../lib/base'
import { groupStage } from '../../lib/controls'
import { errorText } from '../../lib/errorText'
import { matchesQuery } from '../../lib/fold'
import { Badge } from '../../lib/glimstone/Badge'
import { Button } from '../../lib/glimstone/Button'
import { Card } from '../../lib/glimstone/Card'
import { InfoBubble } from '../../lib/glimstone/InfoBubble'
import { useT, type TranslationKey } from '../../lib/i18n'
import { CUSTOM, VPN_PROVIDERS, type VpnField, type VpnProviderState, type VpnState, type VpnStatus } from '../../lib/vpn'
import { SettingsRow } from './rows'

type T = ReturnType<typeof useT>['t']

const LOGOS = new Map(VPN_PROVIDERS.map((p) => [p.id, p.logo]))

/**
 * A provider's logo from public/vpn. Under the pointer its tile fills with the
 * brand's colour and the logo turns that colour's ink, drawn from the logo's
 * own shape or, where the shape has holes, from a mask cut for it. A logo too
 * dark for the page at rest is drawn in the text's colour.
 */
export function VpnMark({ id }: { id: string }) {
  const logo = LOGOS.get(id)
  const src = at(`/vpn/${id}.png`)
  const mask = (url: string, colour: string): CSSProperties => ({
    width: '100%',
    height: '100%',
    backgroundColor: colour,
    mask: `url("${url}") center / contain no-repeat`,
  })
  return (
    <>
      {logo?.rest === 'ink' ? (
        <span aria-hidden className="glim-mark-rest block" style={mask(src, 'currentColor')} />
      ) : (
        <img alt="" src={src} className="glim-mark-rest block h-full w-full object-contain" />
      )}
      <span aria-hidden className="glim-mark-hover" style={mask(logo?.lit ? at(`/vpn/${id}.lit.png`) : src, 'var(--tile-ink)')} />
    </>
  )
}

/** The own config is no brand, so its name is the interface's words. */
const nameOf = (t: T, p: { id: string; name: string }) => (p.id === CUSTOM ? t('vpn.custom') : p.name)

const STATUS: Record<VpnStatus, { word: TranslationKey; tone: 'ok' | 'warn' | 'fail' | 'neutral' }> = {
  down: { word: 'vpn.status.down', tone: 'neutral' },
  connecting: { word: 'vpn.status.connecting', tone: 'warn' },
  connected: { word: 'vpn.status.connected', tone: 'ok' },
  reconnecting: { word: 'vpn.status.reconnecting', tone: 'warn' },
  failed: { word: 'vpn.status.failed', tone: 'fail' },
}

/** Why a connection failed, by the code the engine gives (internal/vpnconn). */
const FAILURES: Record<string, TranslationKey> = {
  'vpn-config-invalid': 'vpn.error.config',
  'vpn-login-refused': 'vpn.error.login',
  'vpn-timeout': 'vpn.error.timeout',
  'vpn-name-unresolved': 'vpn.error.nameUnresolved',
  'vpn-device-limit': 'vpn.error.deviceLimit',
  'vpn-account-expired': 'vpn.error.accountExpired',
  'vpn-location-unknown': 'vpn.error.locationUnknown',
}

function failureOf(t: T, st: VpnState, name: string): string {
  const key = st.errorCode ? FAILURES[st.errorCode] : undefined
  return key ? `${t(key, { name })} ${st.error ?? ''}`.trim() : (st.error ?? '')
}

/**
 * The VPN the jobs switched to it go through: the provider in use and where
 * its tunnel stands, the jobs that use it, and a test that brings it up once.
 * The tunnel is only up while such a job runs, so "off" is its resting state
 * and no fault.
 */
export function VpnCard({ hueIndex }: { hueIndex: number }) {
  const { t } = useT()
  const [offered, setOffered] = useState<boolean | null>(null)
  const [vpn, setVpn] = useState<VpnState | null>(null)
  const [jobs, setJobs] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .capabilities()
      .then((c) => setOffered(!!c.vpn))
      .catch(() => setOffered(false))
  }, [])
  useEffect(() => {
    if (!offered) return
    const read = () =>
      api
        .vpn()
        .then(setVpn)
        .catch((e) => setError(errorText(t, e)))
    read()
    api
      .jobs()
      .then((list) => setJobs(list.filter((j) => j.vpn).map((j) => j.name)))
      .catch(() => {})
    // The tunnel comes and goes with the runs, so the badge is read again
    // while the card is open.
    const every = window.setInterval(read, 5000)
    return () => window.clearInterval(every)
  }, [offered, t])

  // A phone leaves the VPN to the system's own.
  if (!offered) return null
  if (!vpn) {
    return (
      <Card title={t('vpn.title')} hint={t('vpn.hint')} hueIndex={hueIndex}>
        <p className="text-subline text-carbon-textSub">{error ?? t('vpn.reading')}</p>
      </Card>
    )
  }

  const inUse = vpn.providers.find((p) => p.id === vpn.provider)
  const status = STATUS[vpn.status]

  return (
    <Card title={t('vpn.title')} hint={t('vpn.hint')} hueIndex={hueIndex}>
      {!inUse ? (
        <p className="text-subline text-carbon-textSub">{t('vpn.none')}</p>
      ) : (
        <>
          <SettingsRow label={nameOf(t, inUse)}>
            <Badge tone={status.tone}>
              {vpn.status === 'connected' && vpn.jobs.length > 0
                ? t('vpn.carrying', { jobs: vpn.jobs.join(', ') })
                : t(status.word)}
            </Badge>
          </SettingsRow>
          {vpn.status === 'failed' && (
            <p role="status" className="text-subline text-statusFail">
              {failureOf(t, vpn, nameOf(t, inUse))}
            </p>
          )}
          <SettingsRow label={t('vpn.jobs')} hint={t('vpn.jobsHint')}>
            <span className="text-subline text-carbon-textSub">{jobs.length > 0 ? jobs.join(', ') : t('vpn.jobsNone')}</span>
          </SettingsRow>
          <TestButton onState={setVpn} />
        </>
      )}

      <div className="flex flex-wrap justify-end gap-2" data-new="vpn">
        {inUse && (
          <>
            <Button
              label={t('edit.remove')}
              labelKey="edit.remove"
              onClick={() => void api.forgetVpn(inUse.id).then(setVpn, (e) => setError(errorText(t, e)))}
            />
            <Button label={t('vpn.edit')} labelKey="vpn.edit" onClick={() => setEditing(inUse.id)} />
          </>
        )}
        <Button
          label={inUse ? t('vpn.other') : t('vpn.setUp')}
          labelKey={inUse ? 'vpn.other' : 'vpn.setUp'}
          glyph={inUse ? undefined : <IconAdd />}
          onClick={() => setPicking(true)}
        />
      </div>

      {picking && (
        <VpnPicker
          vpn={vpn}
          hueIndex={hueIndex}
          onPick={(id) => {
            setPicking(false)
            setEditing(id)
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {editing && (
        <VpnForm
          provider={vpn.providers.find((p) => p.id === editing)!}
          current={inUse}
          hueIndex={hueIndex}
          onBack={
            editing === vpn.provider
              ? undefined
              : () => {
                  setEditing(null)
                  setPicking(true)
                }
          }
          onSaved={(next) => {
            setVpn(next)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  )
}

/**
 * The providers as tiles with their logos, the way a target's product is
 * picked, and a WireGuard server of one's own after them.
 */
function VpnPicker({
  vpn,
  hueIndex,
  onPick,
  onClose,
}: {
  vpn: VpnState
  hueIndex: number
  onPick: (id: string) => void
  onClose: () => void
}) {
  const { t } = useT()
  const [query, setQuery] = useState('')
  const tiles = (own: boolean) =>
    vpn.providers
      .filter((p) => (p.id === CUSTOM) === own && matchesQuery(query, [nameOf(t, p), p.id]))
      .map((p) => {
        const logo = LOGOS.get(p.id)
        return {
          id: p.id,
          name: nameOf(t, p),
          mark: <VpnMark id={p.id} />,
          lit: logo && { tile: logo.tile, ink: logo.ink },
          ...(own ? { hint: t('vpn.customHint'), bubble: true } : p.configured ? { hint: t('vpn.saved') } : {}),
        }
      })
  const sections = [
    { id: 'providers', title: t('vpn.pickProviders'), tiles: tiles(false) },
    { id: 'own', title: t('vpn.pickOwn'), tiles: tiles(true) },
  ].filter((s) => s.tiles.length > 0)

  return (
    <PickerWindow
      title={t('vpn.pick')}
      hint={t('vpn.pickHint')}
      hueIndex={hueIndex}
      query={query}
      onQuery={setQuery}
      searchLabel={t('vpn.search')}
      none={t('vpn.searchNone', { query: query.trim() })}
      sections={sections.map((s) => ({ id: s.id, title: s.title, body: <PickTiles tiles={s.tiles} onPick={onPick} /> }))}
      onClose={onClose}
    />
  )
}

const FIELDS: Record<VpnField, { label: TranslationKey; hint?: TranslationKey; secret?: boolean }> = {
  config: { label: 'vpn.field.config' },
  accountNumber: { label: 'vpn.field.accountNumber', hint: 'vpn.field.accountNumberHint', secret: true },
  token: { label: 'vpn.field.token', hint: 'vpn.field.tokenHint', secret: true },
  username: { label: 'vpn.field.username', hint: 'vpn.field.usernameHint' },
  password: { label: 'vpn.field.password', secret: true },
  location: { label: 'vpn.field.location', hint: 'vpn.field.locationHint' },
}

/** What each provider takes as a location, and what an empty field means there. */
const LOCATION_HINTS: Partial<Record<string, TranslationKey>> = {
  nordvpn: 'vpn.field.locationHint.nordvpn',
  pia: 'vpn.field.locationHint.pia',
  mullvad: 'vpn.field.locationHint.mullvad',
  hideme: 'vpn.field.locationHint.hideme',
  torguard: 'vpn.field.locationHint.torguard',
  azirevpn: 'vpn.field.locationHint.azirevpn',
  obscura: 'vpn.field.locationHint.obscura',
}

/** What a provider's login needs said before it is entered. */
const NOTES: Partial<Record<string, TranslationKey>> = {
  kaspersky: 'vpn.note.kaspersky',
  anonine: 'vpn.note.anonine',
  nordvpn: 'vpn.note.nordvpn',
  pia: 'vpn.note.pia',
  torguard: 'vpn.note.torguard',
}

type Values = Partial<Record<VpnField, string>>

/**
 * One provider's login. A stored login never comes back to the page, so its
 * fields start empty and an empty field keeps what is stored. Saving makes
 * the provider the one jobs go through; nothing connects until a job runs.
 */
function VpnForm({
  provider: p,
  current,
  hueIndex,
  onBack,
  onSaved,
  onClose,
}: {
  provider: VpnProviderState
  current?: VpnProviderState
  hueIndex: number
  /** Back to the tiles, for a provider just picked from them. */
  onBack?: () => void
  onSaved: (next: VpnState) => void
  onClose: () => void
}) {
  const { t } = useT()
  const [values, setValues] = useState<Values>({})
  const [missing, setMissing] = useState<VpnField | ''>('')
  const [refusal, setRefusal] = useState('')
  const [busy, setBusy] = useState(false)
  const name = nameOf(t, p)
  const filled = p.configured || p.fields.every((f) => f === 'location' || values[f]?.trim())
  const note = NOTES[p.id]
  const hintOf = (f: VpnField) => {
    const key = (f === 'location' && LOCATION_HINTS[p.id]) || FIELDS[f].hint
    return key && t(key, { name })
  }

  const set = (f: VpnField, v: string) => {
    setValues((was) => ({ ...was, [f]: v }))
    if (missing === f) setMissing('')
    setRefusal('')
  }

  async function save() {
    setBusy(true)
    try {
      onSaved(await api.saveVpn(p.id, values))
    } catch (e) {
      const field = e instanceof ApiError ? (e.values?.field as VpnField | undefined) : undefined
      if (e instanceof ApiError && e.code === 'vpn-field-missing' && field) setMissing(field)
      else if (e instanceof ApiError && e.code === 'vpn-config-invalid') setRefusal(`${t('vpn.error.config', { name })} ${e.message}`)
      else setRefusal(errorText(t, e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={name}
      hint={t('vpn.formHint', { name })}
      hueIndex={hueIndex}
      width="wide"
      closeOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          {onBack ? (
            <Button label={t('preview.back')} labelKey="preview.back" onClick={onBack} />
          ) : (
            <Button label={t('vpn.cancel')} labelKey="vpn.cancel" onClick={onClose} />
          )}
          <span className="flex-1" />
          <Button
            label={t('vpn.save')}
            labelKey="vpn.save"
            tone="accent"
            busy={busy}
            disabled={busy || !filled}
            onClick={() => void save()}
          />
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <span className="flex h-9 w-11 shrink-0">
          <VpnMark id={p.id} />
        </span>
        {note && <p className="text-subline text-carbon-textSub">{t(note, { name })}</p>}
        {current && current.id !== p.id && (
          <p className="rounded-control bg-statusWarnBgSoft px-3 py-2.5 text-subline text-carbon-text">
            {t('vpn.replaces', { name, current: nameOf(t, current) })}
          </p>
        )}
        {p.configured && <p className="text-meta text-carbon-textSub">{t('vpn.keepSaved')}</p>}
        {p.fields.map((f) => (
          <div key={f} className="flex flex-col gap-1.5">
            {f === 'config' ? (
              <ConfigField
                hint={t(p.id === CUSTOM ? 'vpn.field.configHintOwn' : 'vpn.field.configHint', { name })}
                value={values.config ?? ''}
                onValue={(v) => set('config', v)}
              />
            ) : (
              <FieldRow label={t(FIELDS[f].label)} hint={hintOf(f)}>
                {FIELDS[f].secret ? (
                  <Secret value={values[f] ?? ''} onChange={(v) => set(f, v)} autoComplete="off" label={t(FIELDS[f].label)} />
                ) : (
                  <Text
                    value={values[f] ?? (f === 'location' ? (p.location ?? '') : '')}
                    onChange={(v) => set(f, v)}
                    label={t(FIELDS[f].label)}
                    mono
                  />
                )}
              </FieldRow>
            )}
            {missing === f && <p className="text-meta text-statusFail">{t('vpn.field.missing')}</p>}
          </div>
        ))}
        {refusal && (
          <p role="alert" className="text-subline text-statusFail">
            {refusal}
          </p>
        )}
      </div>
    </Dialog>
  )
}

/** A .conf file, picked or pasted. */
function ConfigField({ hint, value, onValue }: { hint: string; value: string; onValue: (v: string) => void }) {
  const { t } = useT()
  const file = useRef<HTMLInputElement>(null)
  const label = t('vpn.field.config')
  return (
    <>
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-body text-carbon-text">
          {label}
          <InfoBubble tip={hint} />
        </span>
        <Button label={t('vpn.field.chooseFile')} labelKey="vpn.field.chooseFile" onClick={() => file.current?.click()} />
      </span>
      <textarea
        dir="ltr"
        rows={7}
        spellCheck={false}
        aria-label={label}
        value={value}
        placeholder={'[Interface]\nPrivateKey = …\nAddress = 10.0.0.2/32\n\n[Peer]\nPublicKey = …\nEndpoint = vpn.example.net:51820'}
        onChange={(e) => onValue(e.target.value)}
        className="w-full resize-y bg-carbon-surface2 px-3 py-2 font-mono text-meta text-carbon-text outline-none transition placeholder:text-(--field-placeholder) focus:brightness-125"
        style={{ borderRadius: 'var(--radius-control)' }}
      />
      <input
        ref={file}
        type="file"
        accept=".conf,text/plain"
        className="hidden"
        data-testid="vpn-config-file"
        onChange={(e) => {
          const f = e.target.files?.[0]
          // Cleared so picking the same file again fires a change.
          e.target.value = ''
          if (f) void f.text().then(onValue)
        }}
      />
    </>
  )
}

/** Brings the tunnel up once, as a run would, and says where traffic leaves. */
function TestButton({ onState }: { onState: (next: VpnState) => void }) {
  const { t } = useT()
  const [testing, setTesting] = useState(false)
  const [verdict, setVerdict] = useState<{ ok: boolean; said?: string } | null>(null)

  async function test() {
    setTesting(true)
    setVerdict(null)
    try {
      const answer = await api.testVpn()
      onState(answer.state)
      setVerdict({
        ok: answer.ok,
        said: answer.ok ? (answer.state.exitIp ? t('vpn.exit', { address: answer.state.exitIp }) : undefined) : answer.reason,
      })
    } catch (e) {
      setVerdict({ ok: false, said: errorText(t, e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        label={testing ? t('vpn.testing') : !verdict ? t('vpn.test') : verdict.ok ? t('vpn.testOk') : t('vpn.testFailed')}
        labelKey="vpn.test"
        glyph={testing || !verdict ? undefined : verdict.ok ? <IconCheck /> : <IconClose />}
        tone={testing || !verdict ? 'neutral' : verdict.ok ? 'ok' : 'danger'}
        className={verdict && !verdict.ok && !testing ? 'glim-shake' : ''}
        busy={testing}
        stage={groupStage([t('vpn.test'), t('vpn.testing'), t('vpn.testOk'), t('vpn.testFailed')])}
        onClick={() => void test()}
        disabled={testing}
      />
      {verdict?.said && (
        <p className={`self-stretch text-end text-subline ${verdict.ok ? 'text-carbon-textSub' : 'text-statusFail'}`}>{verdict.said}</p>
      )}
    </div>
  )
}
