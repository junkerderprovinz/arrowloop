import { useEffect, useRef, useState, type HTMLAttributes } from 'react'
import { PickerWindow, type PickerItem, type TileMark } from '@glimstone/react/PickerWindow'

import { Dialog } from '../../components/Dialog'
import { FIELD_FOCUS, FieldRow, Secret, Text } from '../../components/Field'
import { IconAdd, IconCheck, IconClose } from '../../components/glyphs'
import { api, ApiError } from '../../lib/api'
import { at } from '../../lib/base'
import { groupStage } from '../../lib/controls'
import { errorText } from '../../lib/errorText'
import { Badge } from '../../lib/glimstone/Badge'
import { Button } from '../../lib/glimstone/Button'
import { Card } from '../../lib/glimstone/Card'
import { InfoBubble } from '../../lib/glimstone/InfoBubble'
import { useT, type TranslationKey } from '../../lib/i18n'
import { SubCard } from '../../lib/glimstone/SubCard'
import {
  CUSTOM,
  tunnelName,
  VPN_PROVIDERS,
  type VpnField,
  type VpnProviderState,
  type VpnState,
  type VpnStatus,
  type VpnTunnelState,
} from '../../lib/vpn'
import { SettingsRow } from './rows'

type T = ReturnType<typeof useT>['t']

const LOGOS = new Map(VPN_PROVIDERS.map((p) => [p.id, p.logo]))

const masked = (url: string) =>
  `<span style="display:block;width:100%;height:100%;background-color:currentColor;mask:url(&quot;${url}&quot;) center / contain no-repeat"></span>`

/**
 * A provider's logo from public/vpn as the picker's tiles take it. Under the
 * pointer the tile fills with the brand's colour and the logo turns that
 * colour's ink, drawn from the logo's own shape or, where the shape has holes,
 * from a mask cut for it. A logo too dark for the page at rest is drawn in the
 * text's colour.
 */
export function vpnTileMark(id: string): TileMark {
  const logo = LOGOS.get(id)
  const src = at(`/vpn/${id}.png`)
  const rest =
    logo?.rest === 'ink' ? masked(src) : `<img alt="" src="${src}" style="display:block;width:100%;height:100%;object-fit:contain">`
  return { svg: rest, hover: masked(logo?.lit ? at(`/vpn/${id}.lit.png`) : src), tile: logo?.tile, ink: logo?.ink }
}

/** A provider's logo as it stands at rest, outside the picker. */
export function VpnMark({ id }: { id: string }) {
  return <span aria-hidden className="flex h-full w-full" dangerouslySetInnerHTML={{ __html: vpnTileMark(id).svg }} />
}

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

/**
 * Why a VPN did not come up, in the reader's words where the engine gave a
 * code, and the engine's own English for the tooltip.
 */
function failureOf(t: T, st: Pick<VpnTunnelState, 'error' | 'errorCode'>, name: string): { said: string; detail?: string } {
  const key = st.errorCode ? FAILURES[st.errorCode] : undefined
  return key ? { said: t(key, { name }), detail: st.error } : { said: st.error ?? '' }
}

/** What the form is open for: a new VPN of a provider, or the login of one set up. */
type Editing = { provider: string; tunnel?: VpnTunnelState }

/**
 * The VPNs jobs can go through, each with where its tunnel stands, the jobs
 * that name it and a test that brings it up once. Until one is set up the card
 * only offers to set one up. A tunnel is only up while such a job runs, so
 * "off" is its resting state and no fault.
 */
export function VpnCard({ hueIndex }: { hueIndex: number }) {
  const { t } = useT()
  const [offered, setOffered] = useState<boolean | null>(null)
  const [vpn, setVpn] = useState<VpnState | null>(null)
  const [jobs, setJobs] = useState<{ name: string; vpn?: string }[]>([])
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
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
      .then(setJobs)
      .catch(() => {})
    // The tunnels come and go with the runs, so the badges are read again
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

  const provider = (id: string) => vpn.providers.find((p) => p.id === id)

  return (
    <Card title={t('vpn.title')} hint={t('vpn.hint')} hueIndex={hueIndex}>
      {vpn.tunnels.length === 0 ? (
        <p className="text-subline text-carbon-textSub">{t('vpn.none')}</p>
      ) : (
        vpn.tunnels.map((tunnel) => (
          <TunnelCard
            key={tunnel.id}
            tunnel={tunnel}
            name={tunnelName(tunnel, vpn.providers)}
            jobs={jobs.filter((j) => j.vpn === tunnel.id).map((j) => j.name)}
            onState={setVpn}
            onEdit={() => setEditing({ provider: tunnel.provider, tunnel })}
            onRemove={() => void api.forgetVpn(tunnel.id).then(setVpn, (e) => setError(errorText(t, e)))}
          />
        ))
      )}

      <div className="flex flex-wrap justify-end gap-2" data-new="vpn">
        <Button label={t('vpn.setUp')} labelKey="vpn.setUp" glyph={<IconAdd />} onClick={() => setPicking(true)} />
      </div>

      {picking && (
        <VpnPicker
          vpn={vpn}
          onPick={(id) => {
            setPicking(false)
            setEditing({ provider: id })
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {editing && provider(editing.provider) && (
        <VpnForm
          provider={provider(editing.provider)!}
          tunnel={editing.tunnel}
          name={editing.tunnel ? tunnelName(editing.tunnel, vpn.providers) : provider(editing.provider)!.name}
          hueIndex={hueIndex}
          onBack={
            editing.tunnel
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

/** One VPN: its logo and where it stands, the jobs that name it, and what can be done with it. */
function TunnelCard({
  tunnel,
  name,
  jobs,
  onState,
  onEdit,
  onRemove,
}: {
  tunnel: VpnTunnelState
  name: string
  jobs: string[]
  onState: (next: VpnState) => void
  onEdit: () => void
  onRemove: () => void
}) {
  const { t } = useT()
  // A test that failed says why itself, so the status line steps back.
  const [testFailed, setTestFailed] = useState(false)
  const status = STATUS[tunnel.status]
  return (
    <SubCard title={name}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex h-9 w-11 shrink-0">
          <VpnMark id={tunnel.provider} />
        </span>
        <Badge tone={status.tone}>
          {tunnel.status === 'connected' && tunnel.jobs.length > 0 ? t('vpn.carrying', { jobs: tunnel.jobs.join(', ') }) : t(status.word)}
        </Badge>
      </div>
      {tunnel.status === 'failed' && !testFailed && <FailedBecause {...failureOf(t, tunnel, name)} role="status" />}
      <SettingsRow label={t('vpn.jobs')} hint={t('vpn.jobsHint')}>
        <span className="text-subline text-carbon-textSub">{jobs.length > 0 ? jobs.join(', ') : t('vpn.jobsNone')}</span>
      </SettingsRow>
      <TestButton tunnel={tunnel.id} name={name} onState={onState} onFailed={setTestFailed} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button label={t('edit.remove')} labelKey="edit.remove" onClick={onRemove} />
        <Button label={t('vpn.edit')} labelKey="vpn.edit" onClick={onEdit} />
      </div>
    </SubCard>
  )
}

/**
 * The providers as tiles with their logos, in the window a target's product
 * and a notification channel are picked in, and a WireGuard server of one's
 * own after them.
 */
function VpnPicker({ vpn, onPick, onClose }: { vpn: VpnState; onPick: (id: string) => void; onClose: () => void }) {
  const { t } = useT()
  const items: PickerItem[] = vpn.providers.map((p) => ({
    id: p.id,
    label: p.name,
    mark: vpnTileMark(p.id),
    group: p.id === CUSTOM ? 'own' : 'providers',
    ...(p.id === CUSTOM && { hint: t('vpn.customHint') }),
    sub: vpn.tunnels.some((x) => x.provider === p.id) ? t('vpn.saved') : undefined,
  }))

  return (
    <PickerWindow
      title={t('vpn.pick')}
      hint={t('vpn.pickHint')}
      items={items}
      groups={[
        { id: 'providers', title: t('vpn.pickProviders') },
        { id: 'own', title: t('vpn.pickOwn') },
      ]}
      text={{
        search: t('vpn.search'),
        clear: t('settings.searchClear'),
        none: t('vpn.searchNone'),
        close: t('common.close'),
        cancel: t('vpn.cancel'),
        back: t('preview.back'),
      }}
      onPick={onPick}
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
 * A provider's login, for a new VPN or one set up. A stored login never comes
 * back to the page, so the fields of one set up start empty and an empty field
 * keeps what is stored. Nothing connects until a job that names it runs.
 */
function VpnForm({
  provider: p,
  tunnel,
  name,
  hueIndex,
  onBack,
  onSaved,
  onClose,
}: {
  provider: VpnProviderState
  /** The VPN whose login this changes; a new one without it. */
  tunnel?: VpnTunnelState
  name: string
  hueIndex: number
  /** Back to the tiles, for a provider just picked from them. */
  onBack?: () => void
  onSaved: (next: VpnState) => void
  onClose: () => void
}) {
  const { t } = useT()
  const [values, setValues] = useState<Values>({})
  const [missing, setMissing] = useState<VpnField | ''>('')
  const [refusal, setRefusal] = useState<{ said: string; detail?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const filled = !!tunnel || p.fields.every((f) => f === 'location' || values[f]?.trim())
  const note = NOTES[p.id]
  const hintOf = (f: VpnField) => {
    const key = (f === 'location' && LOCATION_HINTS[p.id]) || FIELDS[f].hint
    return key && t(key, { name })
  }

  const set = (f: VpnField, v: string) => {
    setValues((was) => ({ ...was, [f]: v }))
    if (missing === f) setMissing('')
    setRefusal(null)
  }

  async function save() {
    setBusy(true)
    try {
      onSaved(tunnel ? await api.saveVpn(tunnel.id, values) : (await api.addVpn(p.id, values)).state)
    } catch (e) {
      const field = e instanceof ApiError ? (e.values?.field as VpnField | undefined) : undefined
      if (e instanceof ApiError && e.code === 'vpn-field-missing' && field) setMissing(field)
      else if (e instanceof ApiError && e.code === 'vpn-config-invalid') {
        const line = e.values?.line
        const said = line ? t('vpn.error.configLine', { line, text: e.values?.text ?? '' }) : t('vpn.error.config', { name })
        setRefusal({ said, detail: e.message })
      } else setRefusal({ said: errorText(t, e) })
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
            label={t('edit.save')}
            labelKey="edit.save"
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
        {tunnel && <p className="text-meta text-carbon-textSub">{t('vpn.keepSaved')}</p>}
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
                    value={values[f] ?? (f === 'location' ? (tunnel?.place ?? '') : '')}
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
        {refusal && <FailedBecause {...refusal} role="alert" />}
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
        className={`w-full resize-y bg-carbon-surface2 px-3 py-2 font-mono text-meta text-carbon-text outline-none transition placeholder:text-(--field-placeholder) ${FIELD_FOCUS}`}
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

/** A failure in the reader's words, with the engine's own on hover. */
function FailedBecause({
  said,
  detail,
  className = '',
  ...rest
}: { said: string; detail?: string } & HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p {...rest} data-tip={detail ? `${said} ${detail}` : undefined} className={`text-subline text-statusFail ${className}`}>
      {said}
    </p>
  )
}

/** Brings a VPN up once, as a run would, and says where traffic leaves. */
function TestButton({
  tunnel,
  name,
  onState,
  onFailed,
}: {
  tunnel: string
  name: string
  onState: (next: VpnState) => void
  onFailed: (failed: boolean) => void
}) {
  const { t } = useT()
  const [testing, setTesting] = useState(false)
  const [verdict, setVerdict] = useState<{ ok: boolean; said?: string; detail?: string } | null>(null)
  useEffect(() => onFailed(verdict?.ok === false), [verdict, onFailed])

  async function test() {
    setTesting(true)
    setVerdict(null)
    try {
      const answer = await api.testVpn(tunnel)
      onState(answer.state)
      const st = answer.state.tunnels.find((x) => x.id === tunnel)
      if (answer.ok) {
        setVerdict({ ok: true, said: st?.exitIp ? t('vpn.exit', { address: st.exitIp }) : undefined })
      } else {
        setVerdict({ ok: false, ...failureOf(t, { errorCode: st?.errorCode, error: answer.reason ?? st?.error }, name) })
      }
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
      {verdict?.said &&
        (verdict.ok ? (
          <p className="self-stretch text-end text-subline text-carbon-textSub">{verdict.said}</p>
        ) : (
          <FailedBecause said={verdict.said} detail={verdict.detail} data-testid="vpn-verdict" className="self-stretch text-end" />
        ))}
    </div>
  )
}
