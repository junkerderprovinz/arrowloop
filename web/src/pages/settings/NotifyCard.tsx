import { useEffect, useState } from 'react'

import { Choice, FieldRow, NumberField, Text } from '../../components/Field'
import { IconCheck, IconClose } from '../../components/glyphs'
import { Selector } from '../../components/Selector'
import { ToggleRow } from '../../components/ToggleRow'
import { api } from '../../lib/api'
import { groupStage } from '../../lib/controls'
import { Button } from '../../lib/glimstone/Button'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { notifyWhen, channelOn, type Channel, type Notify } from '../../lib/notify'
import { SecretRow, SettingsRow, SubCard } from './rows'

/**
 * When a message goes out and through which channels, one sub-card each. A
 * channel's switch turns it off without clearing it, and its fields fold away
 * while it is off. The secrets stay on the server and show as Saved.
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

  const set = (next: Partial<Notify>) => setNotify({ ...notify, ...next })
  const matrix = notify.matrix ?? { homeserver: '', room: '', token: '' }
  const setMatrix = (next: Partial<typeof matrix>) => set({ matrix: { ...matrix, ...next } })
  const smtp = notify.smtp ?? {}
  const setSmtp = (next: Partial<typeof smtp>) => set({ smtp: { ...smtp, ...next } })
  const apprise = notify.apprise ?? {}
  const setApprise = (next: Partial<typeof apprise>) => set({ apprise: { ...apprise, ...next } })
  const checks = notify.healthchecks ?? {}
  const setChecks = (next: Partial<typeof checks>) => set({ healthchecks: { ...checks, ...next } })
  const ownChecks = checks.jobs ?? {}
  const setOwnChecks = (next: Record<string, string>) => setChecks({ jobs: next })
  const unlisted = jobs.filter((name) => !(name in ownChecks))

  const toggle = (channel: Channel, hue: number) => (
    <ToggleRow
      label={t('notify.use')}
      checked={channelOn(notify, channel)}
      onChange={(on) => {
        if (channel === 'webhook') set({ webhookEnabled: on })
        else if (channel === 'matrix') setMatrix({ enabled: on })
        else if (channel === 'smtp') setSmtp({ enabled: on })
        else if (channel === 'apprise') setApprise({ enabled: on })
        else setChecks({ enabled: on })
      }}
      hueIndex={hue}
    />
  )

  return (
    <Card title={t('settings.notifications')} hueIndex={hueIndex}>
      <SettingsRow label={t('notify.when')} hint={t('notify.whenHint')}>
        <Selector<'never' | 'failure' | 'always'>
          scale="small"
          low
          hug
          label={t('notify.when')}
          value={notifyWhen(notify)}
          // onSuccess is the older spelling of always, and a written on outranks it.
          onChange={(on) => set({ on, onSuccess: undefined })}
          options={[
            { value: 'never', label: t('notify.whenNever') },
            { value: 'failure', label: t('notify.whenFailure') },
            { value: 'always', label: t('notify.whenAlways') },
          ]}
        />
      </SettingsRow>

      <SubCard label={t('notify.webhook')} hint={t('notify.webhookHint')}>
        {toggle('webhook', 0)}
        {channelOn(notify, 'webhook') && (
          <>
            {/* A webhook's address is its own key, so it is kept like a token. */}
            <SecretRow
              label={t('notify.address')}
              value={notify.webhook ?? ''}
              onChange={(webhook) => set({ webhook })}
              placeholder="https://discord.com/api/webhooks/..."
            />
            <FieldRow label={t('notify.format')} width="w-56">
              <Choice
                label={t('notify.format')}
                value={notify.webhookFormat || 'generic'}
                onChange={(webhookFormat) => set({ webhookFormat })}
                options={[
                  { value: 'generic', label: t('notify.formatGeneric') },
                  { value: 'discord', label: 'Discord' },
                  { value: 'slack', label: 'Slack' },
                  { value: 'gotify', label: 'Gotify' },
                  { value: 'ntfy', label: 'ntfy' },
                ]}
              />
            </FieldRow>
            <TestButton channel="webhook" notify={notify} />
          </>
        )}
      </SubCard>

      <SubCard label={t('notify.matrix')} hint={t('notify.matrixHint')}>
        {toggle('matrix', 1)}
        {channelOn(notify, 'matrix') && (
          <>
            <FieldRow label={t('engine.matrixHome')}>
              <Text
                value={matrix.homeserver}
                onChange={(homeserver) => setMatrix({ homeserver })}
                placeholder="https://matrix.example.org"
                label={t('engine.matrixHome')}
                mono
              />
            </FieldRow>
            <FieldRow label={t('engine.matrixRoom')}>
              <Text
                value={matrix.room}
                onChange={(room) => setMatrix({ room })}
                placeholder="!abc:example.org"
                label={t('engine.matrixRoom')}
                mono
              />
            </FieldRow>
            <SecretRow label={t('engine.matrixToken')} value={matrix.token} onChange={(token) => setMatrix({ token })} />
            <TestButton channel="matrix" notify={notify} />
          </>
        )}
      </SubCard>

      <SubCard label={t('notify.smtp')} hint={t('notify.smtpHint')}>
        {toggle('smtp', 2)}
        {channelOn(notify, 'smtp') && (
          <>
            <FieldRow label={t('notify.smtpHost')}>
              <Text
                value={smtp.host ?? ''}
                onChange={(host) => setSmtp({ host })}
                placeholder="mail.example.org"
                label={t('notify.smtpHost')}
                mono
              />
            </FieldRow>
            <SettingsRow label={t('notify.smtpTls')}>
              <Selector<'starttls' | 'tls' | 'none'>
                scale="small"
                low
                hug
                label={t('notify.smtpTls')}
                value={(smtp.tls as 'starttls' | 'tls' | 'none' | undefined) || 'starttls'}
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
                value={smtp.port ?? (smtp.tls === 'tls' ? 465 : 587)}
                min={1}
                max={65535}
                label={t('notify.smtpPort')}
                onChange={(port) => setSmtp({ port })}
              />
            </SettingsRow>
            <FieldRow label={t('notify.smtpUser')}>
              <Text value={smtp.username ?? ''} onChange={(username) => setSmtp({ username })} label={t('notify.smtpUser')} mono />
            </FieldRow>
            <SecretRow label={t('notify.smtpPassword')} value={smtp.password ?? ''} onChange={(password) => setSmtp({ password })} />
            <FieldRow label={t('notify.smtpFrom')}>
              <Text
                value={smtp.from ?? ''}
                onChange={(from) => setSmtp({ from })}
                placeholder="arrowloop@example.org"
                label={t('notify.smtpFrom')}
                mono
              />
            </FieldRow>
            <FieldRow label={t('notify.smtpTo')} hint={t('notify.smtpToHint')}>
              <Text
                value={smtp.to ?? ''}
                onChange={(to) => setSmtp({ to })}
                placeholder="me@example.org"
                label={t('notify.smtpTo')}
                mono
              />
            </FieldRow>
            <TestButton channel="smtp" notify={notify} />
          </>
        )}
      </SubCard>

      <SubCard label={t('notify.apprise')} hint={t('notify.appriseHint')}>
        {toggle('apprise', 3)}
        {channelOn(notify, 'apprise') && (
          <>
            <SecretRow
              label={t('notify.address')}
              value={apprise.url ?? ''}
              onChange={(url) => setApprise({ url })}
              placeholder="http://apprise:8000/notify/arrowloop"
            />
            <FieldRow label={t('notify.appriseTags')} hint={t('notify.appriseTagsHint')}>
              <Text
                value={apprise.tags ?? ''}
                onChange={(tags) => setApprise({ tags })}
                placeholder="backups"
                label={t('notify.appriseTags')}
                mono
              />
            </FieldRow>
            <TestButton channel="apprise" notify={notify} />
          </>
        )}
      </SubCard>

      <SubCard label={t('notify.healthchecks')} hint={t('notify.healthchecksHint')}>
        {toggle('healthchecks', 4)}
        {channelOn(notify, 'healthchecks') && (
          <>
            <SecretRow
              label={t('notify.hcShared')}
              value={checks.url ?? ''}
              onChange={(url) => setChecks({ url })}
              placeholder="https://hc-ping.com/..."
            />
            {Object.keys(ownChecks)
              .sort()
              .map((name) => (
                <div key={name} className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <SecretRow
                      label={name}
                      value={ownChecks[name]}
                      onChange={(url) => setOwnChecks({ ...ownChecks, [name]: url })}
                      placeholder="https://hc-ping.com/..."
                    />
                  </div>
                  <Button
                    label={t('edit.remove')}
                    labelKey="edit.remove"
                    onClick={() => {
                      const rest = { ...ownChecks }
                      delete rest[name]
                      setOwnChecks(rest)
                    }}
                  />
                </div>
              ))}
            {unlisted.length > 0 && (
              <SettingsRow label={t('notify.hcJobs')} hint={t('notify.hcJobsHint')}>
                <Choice
                  label={t('notify.hcJobs')}
                  value=""
                  onChange={(name) => name && setOwnChecks({ ...ownChecks, [name]: '' })}
                  options={[{ value: '', label: t('notify.hcAddJob') }, ...unlisted.map((name) => ({ value: name, label: name }))]}
                />
              </SettingsRow>
            )}
            <TestButton channel="healthchecks" notify={notify} />
          </>
        )}
      </SubCard>
    </Card>
  )
}

/**
 * Sends a test through one channel as the card shows it, saved or not. Colour,
 * word and glyph all carry the verdict, and a refusal says why under it.
 */
function TestButton({ channel, notify }: { channel: Channel; notify: Notify }) {
  const { t } = useT()
  const [sending, setSending] = useState(false)
  const [verdict, setVerdict] = useState<{ ok: boolean; reason?: string } | null>(null)
  const [refused, setRefused] = useState(0)

  // An edit makes the last verdict about settings that are no longer shown.
  useEffect(() => setVerdict(null), [notify])

  async function send() {
    setSending(true)
    setVerdict(null)
    try {
      const answer = await api.testNotify(channel, notify)
      setVerdict(answer)
      if (!answer.ok) setRefused((n) => n + 1)
    } catch (e) {
      setVerdict({ ok: false, reason: (e as Error).message })
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
