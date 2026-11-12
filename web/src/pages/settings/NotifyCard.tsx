import { useEffect, useState } from 'react'

import { Choice, FieldRow, Lines, NumberField, Text } from '../../components/Field'
import { IconCheck, IconClose } from '../../components/glyphs'
import { Selector } from '../../components/Selector'
import { ToggleRow } from '../../components/ToggleRow'
import { api } from '../../lib/api'
import { groupStage } from '../../lib/controls'
import { errorText } from '../../lib/errorText'
import { Button } from '../../lib/glimstone/Button'
import { Card } from '../../lib/glimstone/Card'
import { useT, type TranslationKey } from '../../lib/i18n'
import { KINDS, newChannel, sends, type Channel, type Kind, type Notify, type When } from '../../lib/notify'
import { SecretRow, SettingsRow, SubCard } from './rows'

/** The services' own names, which no language translates. */
const BRANDS: Partial<Record<Kind, string>> = {
  discord: 'Discord',
  slack: 'Slack',
  ntfy: 'ntfy',
  gotify: 'Gotify',
}

const LABELS: Record<Kind, TranslationKey | undefined> = {
  discord: undefined,
  slack: undefined,
  ntfy: undefined,
  gotify: undefined,
  matrix: 'notify.matrix',
  smtp: 'notify.smtp',
  apprise: 'notify.apprise',
  webhook: 'notify.webhook',
  healthchecks: 'notify.healthchecks',
}

const HINTS: Record<Kind, TranslationKey> = {
  discord: 'notify.discordHint',
  slack: 'notify.slackHint',
  ntfy: 'notify.ntfyHint',
  gotify: 'notify.gotifyHint',
  matrix: 'notify.matrixHint',
  smtp: 'notify.smtpHint',
  apprise: 'notify.appriseHint',
  webhook: 'notify.webhookFreeHint',
  healthchecks: 'notify.healthchecksHint',
}

/** What a failed test answers with, by the code the engine gives. */
const FAILURES: Record<string, TranslationKey> = {
  invalid: 'notify.fail.invalid',
  moved: 'notify.fail.moved',
  canceled: 'notify.fail.canceled',
  dns: 'notify.fail.dns',
  refused: 'notify.fail.refused',
  tls: 'notify.fail.tls',
  timeout: 'notify.fail.timeout',
  network: 'notify.fail.network',
  auth: 'notify.fail.auth',
  not_found: 'notify.fail.notFound',
  redirect: 'notify.fail.redirect',
  rejected: 'notify.fail.rejected',
  rate_limited: 'notify.fail.rateLimited',
  server: 'notify.fail.server',
  script: 'notify.fail.script',
  no_starttls: 'notify.fail.noStarttls',
  off: 'notify.fail.off',
}

/**
 * Where messages go: one sub-card per channel, as many as somebody wants, each
 * with its own switch, its own "when" and a test button. A channel's fields
 * fold away while it is off. The secrets stay on the server and show as Saved.
 */
export function NotifyCard({
  notify,
  setNotify,
  hueIndex,
}: {
  notify: Notify
  setNotify: (next: Notify) => void
  hueIndex: number
}) {
  const { t } = useT()
  const [jobs, setJobs] = useState<string[]>([])
  useEffect(() => {
    api
      .jobs()
      .then((list) => setJobs(list.map((j) => j.name)))
      .catch(() => {})
  }, [])

  const channels = notify.channels ?? []
  const setChannels = (next: Channel[]) => setNotify({ ...notify, channels: next })
  const kindLabel = (kind: Kind) => BRANDS[kind] ?? t(LABELS[kind]!)

  return (
    <Card title={t('settings.notifications')} hueIndex={hueIndex}>
      {channels.length === 0 && <p className="text-subline text-carbon-textSub">{t('notify.empty')}</p>}

      {channels.map((c, i) => (
        <ChannelCard
          key={c.id}
          channel={c}
          label={c.name?.trim() || kindLabel(c.kind)}
          hue={i}
          jobs={jobs}
          onChange={(next) => setChannels(channels.map((other) => (other.id === c.id ? next : other)))}
          onRemove={() => setChannels(channels.filter((other) => other.id !== c.id))}
        />
      ))}

      <SettingsRow label={t('notify.add')}>
        <Choice<'' | Kind>
          label={t('notify.add')}
          value=""
          onChange={(kind) => kind && setChannels([...channels, newChannel(kind, channels)])}
          options={[{ value: '', label: t('notify.addChoose') }, ...KINDS.map((k) => ({ value: k, label: kindLabel(k) }))]}
        />
      </SettingsRow>
    </Card>
  )
}

function ChannelCard({
  channel: c,
  label,
  hue,
  jobs,
  onChange,
  onRemove,
}: {
  channel: Channel
  label: string
  hue: number
  jobs: string[]
  onChange: (next: Channel) => void
  onRemove: () => void
}) {
  const { t } = useT()
  const set = (next: Partial<Channel>) => onChange({ ...c, ...next })
  const check = c.kind === 'healthchecks'
  // A check has no "when" of its own beyond never, so its switch is both.
  const on = check ? sends(c) : c.enabled

  return (
    <SubCard label={label} hint={t(HINTS[c.kind])}>
      <ToggleRow
        label={t('notify.use')}
        checked={on}
        onChange={(next) => set(check ? { enabled: next, on: next ? 'always' : c.on } : { enabled: next })}
        hueIndex={hue}
      />
      {on && (
        <>
          <FieldRow label={t('notify.name')} hint={t('notify.nameHint')}>
            <Text value={c.name ?? ''} onChange={(name) => set({ name })} placeholder={label} label={t('notify.name')} />
          </FieldRow>
          {!check && (
            <SettingsRow label={t('notify.when')} hint={t('notify.onHint')}>
              <Selector<When>
                scale="small"
                low
                hug
                label={t('notify.when')}
                value={c.on ?? 'failure'}
                onChange={(on) => set({ on })}
                options={[
                  { value: 'never', label: t('notify.whenNever') },
                  { value: 'failure', label: t('notify.whenFailure') },
                  { value: 'always', label: t('notify.whenAlways') },
                ]}
              />
            </SettingsRow>
          )}
          <Fields channel={c} set={set} jobs={jobs} />
          <TestButton channel={c} />
        </>
      )}
      <div className="flex justify-end">
        <Button label={t('edit.remove')} labelKey="edit.remove" onClick={onRemove} />
      </div>
    </SubCard>
  )
}

/** The settings of one service. */
function Fields({ channel: c, set, jobs }: { channel: Channel; set: (next: Partial<Channel>) => void; jobs: string[] }) {
  const { t } = useT()
  switch (c.kind) {
    case 'discord':
      return (
        <SecretRow
          label={t('notify.address')}
          value={c.discord?.url ?? ''}
          onChange={(url) => set({ discord: { url } })}
          placeholder="https://discord.com/api/webhooks/..."
        />
      )
    case 'slack':
      return (
        <SecretRow
          label={t('notify.address')}
          value={c.slack?.url ?? ''}
          onChange={(url) => set({ slack: { url } })}
          placeholder="https://hooks.slack.com/services/..."
        />
      )
    case 'ntfy': {
      const n = c.ntfy ?? { url: '' }
      return (
        <>
          <SecretRow label={t('notify.address')} value={n.url} onChange={(url) => set({ ntfy: { ...n, url } })} placeholder="https://ntfy.sh/your-topic" />
          <SecretRow label={t('notify.token')} hint={t('notify.tokenHint')} value={n.token ?? ''} onChange={(token) => set({ ntfy: { ...n, token } })} />
        </>
      )
    }
    case 'gotify': {
      const g = c.gotify ?? { url: '' }
      return (
        <>
          <SecretRow label={t('notify.address')} value={g.url} onChange={(url) => set({ gotify: { ...g, url } })} placeholder="https://gotify.example.org" />
          <SecretRow label={t('notify.token')} hint={t('notify.tokenHint')} value={g.token ?? ''} onChange={(token) => set({ gotify: { ...g, token } })} />
          <SettingsRow label={t('notify.priorityFailure')}>
            <NumberField value={g.priorityFailure ?? 8} min={0} max={10} label={t('notify.priorityFailure')} onChange={(v) => set({ gotify: { ...g, priorityFailure: v } })} />
          </SettingsRow>
          <SettingsRow label={t('notify.prioritySuccess')}>
            <NumberField value={g.prioritySuccess ?? 5} min={0} max={10} label={t('notify.prioritySuccess')} onChange={(v) => set({ gotify: { ...g, prioritySuccess: v } })} />
          </SettingsRow>
        </>
      )
    }
    case 'matrix': {
      const m = c.matrix ?? { homeserver: '', room: '', token: '' }
      const setMatrix = (next: Partial<typeof m>) => set({ matrix: { ...m, ...next } })
      return (
        <>
          <FieldRow label={t('engine.matrixHome')}>
            <Text value={m.homeserver} onChange={(homeserver) => setMatrix({ homeserver })} placeholder="https://matrix.example.org" label={t('engine.matrixHome')} mono />
          </FieldRow>
          <FieldRow label={t('engine.matrixRoom')}>
            <Text value={m.room} onChange={(room) => setMatrix({ room })} placeholder="!abc:example.org" label={t('engine.matrixRoom')} mono />
          </FieldRow>
          <SecretRow label={t('engine.matrixToken')} value={m.token} onChange={(token) => setMatrix({ token })} />
        </>
      )
    }
    case 'smtp':
      return <MailFields channel={c} set={set} />
    case 'apprise': {
      const a = c.apprise ?? { url: '' }
      const setApprise = (next: Partial<typeof a>) => set({ apprise: { ...a, ...next } })
      return (
        <>
          <SecretRow label={t('notify.address')} value={a.url} onChange={(url) => setApprise({ url })} placeholder="http://apprise:8000/notify/arrowloop" />
          <SecretRow
            label={t('notify.appriseUrls')}
            hint={t('notify.appriseUrlsHint')}
            value={(a.urls ?? []).join(' ')}
            onChange={(text) => setApprise({ urls: text.split(/\s+/).filter(Boolean) })}
            placeholder="tgram://bottoken/chatid"
          />
          <FieldRow label={t('notify.appriseTags')} hint={t('notify.appriseTagsHint')}>
            <Text value={a.tags ?? ''} onChange={(tags) => setApprise({ tags })} placeholder="backups" label={t('notify.appriseTags')} mono />
          </FieldRow>
        </>
      )
    }
    case 'webhook':
      return <WebhookFields channel={c} set={set} />
    case 'healthchecks':
      return <CheckFields channel={c} set={set} jobs={jobs} />
  }
}

function MailFields({ channel: c, set }: { channel: Channel; set: (next: Partial<Channel>) => void }) {
  const { t } = useT()
  const s = c.smtp ?? { host: '', from: '', to: '' }
  const setSmtp = (next: Partial<typeof s>) => set({ smtp: { ...s, ...next } })
  return (
    <>
      <FieldRow label={t('notify.smtpHost')}>
        <Text value={s.host} onChange={(host) => setSmtp({ host })} placeholder="mail.example.org" label={t('notify.smtpHost')} mono />
      </FieldRow>
      <SettingsRow label={t('notify.smtpTls')}>
        <Selector<'starttls' | 'tls' | 'none'>
          scale="small"
          low
          hug
          label={t('notify.smtpTls')}
          value={(s.tls as 'starttls' | 'tls' | 'none' | undefined) || 'starttls'}
          onChange={(tls) => setSmtp({ tls })}
          options={[
            { value: 'starttls', label: 'STARTTLS' },
            { value: 'tls', label: 'TLS' },
            { value: 'none', label: t('notify.tlsNone') },
          ]}
        />
      </SettingsRow>
      <SettingsRow label={t('notify.smtpPort')}>
        <NumberField
          value={s.port || (s.tls === 'tls' ? 465 : 587)}
          min={1}
          max={65535}
          label={t('notify.smtpPort')}
          onChange={(port) => setSmtp({ port })}
        />
      </SettingsRow>
      <FieldRow label={t('notify.smtpUser')}>
        <Text value={s.username ?? ''} onChange={(username) => setSmtp({ username })} label={t('notify.smtpUser')} mono />
      </FieldRow>
      <SecretRow label={t('notify.smtpPassword')} value={s.password ?? ''} onChange={(password) => setSmtp({ password })} />
      <FieldRow label={t('notify.smtpFrom')}>
        <Text value={s.from} onChange={(from) => setSmtp({ from })} placeholder="arrowloop@example.org" label={t('notify.smtpFrom')} mono />
      </FieldRow>
      <FieldRow label={t('notify.smtpTo')} hint={t('notify.smtpToHint')}>
        <Text value={s.to} onChange={(to) => setSmtp({ to })} placeholder="me@example.org" label={t('notify.smtpTo')} mono />
      </FieldRow>
    </>
  )
}

function WebhookFields({ channel: c, set }: { channel: Channel; set: (next: Partial<Channel>) => void }) {
  const { t } = useT()
  const w = c.webhook ?? { url: '' }
  const setHook = (next: Partial<typeof w>) => set({ webhook: { ...w, ...next } })
  const headers = w.headers ?? {}
  const [adding, setAdding] = useState('')
  return (
    <>
      <SecretRow label={t('notify.address')} value={w.url} onChange={(url) => setHook({ url })} placeholder="https://hooks.example.org/in" />
      <SettingsRow label={t('notify.method')}>
        <Selector<'POST' | 'PUT' | 'GET'>
          scale="small"
          low
          hug
          label={t('notify.method')}
          value={(w.method?.toUpperCase() as 'POST' | 'PUT' | 'GET' | undefined) || 'POST'}
          onChange={(method) => setHook({ method })}
          options={[
            { value: 'POST', label: 'POST' },
            { value: 'PUT', label: 'PUT' },
            { value: 'GET', label: 'GET' },
          ]}
        />
      </SettingsRow>
      {Object.keys(headers)
        .sort()
        .map((name) => (
          <div key={name} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              {/* A header often carries a key, so every value is kept like a token. */}
              <SecretRow label={name} value={headers[name]} onChange={(v) => setHook({ headers: { ...headers, [name]: v } })} />
            </div>
            <Button
              label={t('edit.remove')}
              labelKey="edit.remove"
              onClick={() => {
                const rest = { ...headers }
                delete rest[name]
                setHook({ headers: rest })
              }}
            />
          </div>
        ))}
      <div className="flex flex-wrap items-end justify-end gap-2">
        <div className="min-w-0 flex-[1_1_16rem]">
          <FieldRow label={t('notify.headerName')}>
            <Text value={adding} onChange={setAdding} placeholder="Authorization" label={t('notify.headerName')} mono />
          </FieldRow>
        </div>
        <Button
          label={t('notify.addHeader')}
          labelKey="notify.addHeader"
          disabled={adding.trim() === '' || adding.trim() in headers}
          onClick={() => {
            setHook({ headers: { ...headers, [adding.trim()]: '' } })
            setAdding('')
          }}
        />
      </div>
      {w.method?.toUpperCase() !== 'GET' && (
        <FieldRow label={t('notify.body')} hint={t('notify.bodyHint')}>
          <Lines value={(w.body ?? '').split('\n')} onChange={(lines) => setHook({ body: lines.join('\n') })} rows={3} />
        </FieldRow>
      )}
    </>
  )
}

function CheckFields({ channel: c, set, jobs }: { channel: Channel; set: (next: Partial<Channel>) => void; jobs: string[] }) {
  const { t } = useT()
  const h = c.healthchecks ?? {}
  const own = h.byKey ?? {}
  const setOwn = (byKey: Record<string, string>) => set({ healthchecks: { ...h, byKey } })
  const unlisted = jobs.filter((name) => !(name in own))
  return (
    <>
      <SecretRow label={t('notify.hcShared')} value={h.url ?? ''} onChange={(url) => set({ healthchecks: { ...h, url } })} placeholder="https://hc-ping.com/..." />
      {Object.keys(own)
        .sort()
        .map((name) => (
          <div key={name} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <SecretRow label={name} value={own[name]} onChange={(url) => setOwn({ ...own, [name]: url })} placeholder="https://hc-ping.com/..." />
            </div>
            <Button
              label={t('edit.remove')}
              labelKey="edit.remove"
              onClick={() => {
                const rest = { ...own }
                delete rest[name]
                setOwn(rest)
              }}
            />
          </div>
        ))}
      {unlisted.length > 0 && (
        <SettingsRow label={t('notify.hcJobs')} hint={t('notify.hcJobsHint')}>
          <Choice
            label={t('notify.hcJobs')}
            value=""
            onChange={(name) => name && setOwn({ ...own, [name]: '' })}
            options={[{ value: '', label: t('notify.hcAddJob') }, ...unlisted.map((name) => ({ value: name, label: name }))]}
          />
        </SettingsRow>
      )}
    </>
  )
}

/**
 * Sends a test through one channel as the card shows it, saved or not. Colour,
 * word and glyph all carry the verdict, and a refusal says why under it.
 */
function TestButton({ channel }: { channel: Channel }) {
  const { t } = useT()
  const [sending, setSending] = useState(false)
  const [verdict, setVerdict] = useState<{ ok: boolean; reason?: string } | null>(null)
  const [refused, setRefused] = useState(0)

  // An edit makes the last verdict about settings that are no longer shown.
  useEffect(() => setVerdict(null), [channel])

  async function send() {
    setSending(true)
    setVerdict(null)
    try {
      const answer = await api.testNotify(channel)
      const known = answer.code ? FAILURES[answer.code] : undefined
      const why = known ? t(known) : answer.reason
      setVerdict({ ok: answer.ok, reason: why && answer.status ? `${why} (HTTP ${answer.status})` : why })
      if (!answer.ok) setRefused((n) => n + 1)
    } catch (e) {
      setVerdict({ ok: false, reason: errorText(t, e) })
      setRefused((n) => n + 1)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        key={`test-${refused}`}
        label={
          sending ? t('notify.testing') : !verdict ? t('notify.test') : verdict.ok ? t('notify.testOk') : t('notify.testFailed')
        }
        labelKey="notify.test"
        glyph={sending || !verdict ? undefined : verdict.ok ? <IconCheck /> : <IconClose />}
        tone={sending || !verdict ? 'neutral' : verdict.ok ? 'ok' : 'danger'}
        className={verdict && !verdict.ok && !sending ? 'glim-shake' : ''}
        busy={sending}
        stage={groupStage([t('notify.test'), t('notify.testing'), t('notify.testOk'), t('notify.testFailed')])}
        onClick={() => void send()}
        disabled={sending}
      />
      {verdict && !verdict.ok && verdict.reason && (
        <p className="self-stretch text-subline text-statusFail">{verdict.reason}</p>
      )}
    </div>
  )
}
