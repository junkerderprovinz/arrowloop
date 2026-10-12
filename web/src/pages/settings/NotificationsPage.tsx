import { Field, Text } from '../../components/Field'
import { Stack } from '../../components/Shell'
import { ToggleRow } from '../../components/ToggleRow'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { Reading, useEngineSettings } from './engineSettings'
import { SecretRow, SubCard } from './rows'

/** Where a finished run reports to, by Matrix or by webhook. */
export function NotificationsPage() {
  const { t } = useT()
  const { loaded, draft, patch, error } = useEngineSettings()
  if (!loaded) return <Reading title={t('settings.notifications')} error={error} />

  const notify = draft.notify ?? {}
  const matrix = notify.matrix ?? { homeserver: '', room: '', token: '' }
  const setMatrix = (next: Partial<typeof matrix>) => patch({ notify: { ...notify, matrix: { ...matrix, ...next } } })

  return (
    <Stack>
      <Card title={t('settings.notifications')} hueIndex={0}>
        <ToggleRow
          label={t('engine.onSuccess')}
          checked={!!notify.onSuccess}
          onChange={(v) => patch({ notify: { ...notify, onSuccess: v } })}
          hint={t('engine.onSuccessHint')}
        />
        <SubCard label={t('notify.matrix')} hint={t('engine.matrixHint')}>
          <Field label={t('engine.matrixHome')}>
            <Text
              value={matrix.homeserver}
              onChange={(v) => setMatrix({ homeserver: v })}
              placeholder="https://matrix.example.org"
              mono
            />
          </Field>
          <Field label={t('engine.matrixRoom')}>
            <Text value={matrix.room} onChange={(v) => setMatrix({ room: v })} placeholder="!abc:example.org" mono />
          </Field>
          <SecretRow label={t('engine.matrixToken')} value={matrix.token} onChange={(v) => setMatrix({ token: v })} />
        </SubCard>
        {/* A webhook's address is its own key, so it is kept like the token. */}
        <SecretRow
          label={t('engine.webhook')}
          hint={t('engine.webhookHint')}
          value={typeof notify.webhook === 'string' ? notify.webhook : ''}
          onChange={(v) => patch({ notify: { ...notify, webhook: v } })}
          placeholder="https://example.org/hook"
        />
      </Card>
    </Stack>
  )
}
