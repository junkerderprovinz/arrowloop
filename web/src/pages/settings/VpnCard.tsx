import { useEffect, useRef, useState, type HTMLAttributes } from 'react'
import type { TileMark } from '@glimstone/core'
import { VPN_PROVIDERS as CATALOG } from '@glimstone/core/vpnProviders'
import { ConnectionRow } from '@glimstone/react/ConnectionRow'
import { PickerWindow, type PickerItem } from '@glimstone/react/PickerWindow'

import { Dialog } from '../../components/Dialog'
import { FIELD_FOCUS, FieldRow, Secret, Text } from '../../components/Field'
import { IconAdd } from '../../components/glyphs'
import { api, ApiError } from '../../lib/api'
import { errorText } from '../../lib/errorText'
import { Badge } from '../../lib/glimstone/Badge'
import { Button } from '../../lib/glimstone/Button'
import { Card } from '../../lib/glimstone/Card'
import { InfoBubble } from '../../lib/glimstone/InfoBubble'
import { useT } from '../../lib/i18n'
import {
  CUSTOM,
  tunnelName,
  VPN_FIELDS as FIELDS,
  VPN_NOTES as NOTES,
  VPN_STATUS as STATUS,
  vpnFailure as failureOf,
  vpnFieldHint,
  vpnFilled,
  vpnRefusal,
  type VpnField,
  type VpnProviderState,
  type VpnState,
  type VpnTunnelState,
} from '../../lib/vpn'

const MARKS = new Map<string, TileMark>(CATALOG.entries.flatMap((e) => (e.mark ? [[e.id, e.mark] as const] : [])))

/** A provider's mark from GlimStone's catalog. An engine newer than the catalog can offer a provider it has no mark for. */
export function vpnTileMark(id: string): TileMark {
  return MARKS.get(id) ?? { svg: '' }
}

/** A provider's logo as it stands at rest, outside the picker. */
export function VpnMark({ id }: { id: string }) {
  return <span aria-hidden className="flex h-full w-full" dangerouslySetInnerHTML={{ __html: vpnTileMark(id).svg }} />
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
          <TunnelRow
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

/**
 * One VPN as a connection row: its mark on its brand's tile, how it stands or
 * what its last test found, the jobs that name it, and its test, edit and
 * remove.
 */
function TunnelRow({
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
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [testing, setTesting] = useState(false)
  const status = STATUS[tunnel.status]

  async function test() {
    setTesting(true)
    setVerdict(null)
    try {
      const answer = await api.testVpn(tunnel.id)
      onState(answer.state)
      const st = answer.state.tunnels.find((x) => x.id === tunnel.id)
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

  let line
  if (verdict?.said) {
    line = verdict.ok ? (
      <p className="glim-connection-status">{verdict.said}</p>
    ) : (
      <FailedBecause said={verdict.said} detail={verdict.detail} data-testid="vpn-verdict" />
    )
  } else if (tunnel.status === 'failed' && verdict?.ok !== false) {
    line = <FailedBecause {...failureOf(t, tunnel, name)} role="status" />
  } else {
    line = (
      <p className="glim-connection-status">
        {tunnel.status === 'connected' && tunnel.jobs.length > 0 ? t('vpn.carrying', { jobs: tunnel.jobs.join(', ') }) : t(status.word)}
      </p>
    )
  }

  return (
    <ConnectionRow
      name={name}
      mark={vpnTileMark(tunnel.provider)}
      badges={status.badge && <Badge tone={status.badge}>{t(status.word)}</Badge>}
      test={{ busy: testing, tone: testing || !verdict ? undefined : verdict.ok ? 'ok' : 'danger', title: verdict?.said }}
      text={{ test: t('vpn.test'), edit: t('vpn.edit'), remove: t('edit.remove') }}
      labelKeys={{ test: 'vpn.test', edit: 'vpn.edit', remove: 'edit.remove' }}
      onTest={() => {
        if (!testing) void test()
      }}
      onEdit={onEdit}
      onRemove={onRemove}
    >
      {line}
      <span className="flex min-w-0 items-center gap-1.5 text-meta">
        <span data-glim-label={t('vpn.jobs')} className="shrink-0 text-carbon-textMuted">
          {t('vpn.jobs')}
        </span>
        <InfoBubble tip={t('vpn.jobsHint')} />
        <span className="min-w-0 truncate">{jobs.length > 0 ? jobs.join(', ') : t('vpn.jobsNone')}</span>
      </span>
    </ConnectionRow>
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
  const filled = vpnFilled(p.fields, values, !!tunnel)
  const note = NOTES[p.id]

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
      const read = e instanceof ApiError ? vpnRefusal(t, e, name) : null
      if (read && 'missing' in read) setMissing(read.missing)
      else setRefusal(read ?? { said: errorText(t, e) })
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
                hint={vpnFieldHint(t, p.id, 'config', name) ?? ''}
                value={values.config ?? ''}
                onValue={(v) => set('config', v)}
              />
            ) : (
              <FieldRow label={t(FIELDS[f].label)} hint={vpnFieldHint(t, p.id, f, name)}>
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
        {refusal && <FailedBecause {...refusal} role="alert" className="text-subline text-statusFail" />}
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

/**
 * A failure in the reader's words, with the engine's own on hover. In a row it
 * is the quiet status line, since the badge after the name carries the state.
 */
function FailedBecause({
  said,
  detail,
  className = 'glim-connection-status',
  ...rest
}: { said: string; detail?: string } & HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p {...rest} data-tip={detail ? `${said} ${detail}` : undefined} className={className}>
      {said}
    </p>
  )
}

/** What the last test of a VPN found. */
type Verdict = { ok: boolean; said?: string; detail?: string }
