import { Field, NumberField, Text } from '../../components/Field'
import { Stack } from '../../components/Shell'
import type { Settings } from '../../lib/api'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { Reading, useEngineSettings, waitMinutes } from './engineSettings'
import { SettingsRow } from './rows'

/** How hard the engine may work, where it writes its log, and how it retries. */
export function WorkloadPage() {
  const { t } = useT()
  const { loaded, draft, patch, error } = useEngineSettings()
  if (!loaded) return <Reading title={t('settings.workload')} error={error} />

  const retry = draft.retry ?? {}
  const setRetry = (next: Partial<NonNullable<Settings['retry']>>) => patch({ retry: { ...retry, ...next } })

  return (
    <Stack>
      <Card title={t('settings.workload')} hueIndex={0}>
        <SettingsRow label={t('engine.bwlimit')} hint={t('engine.bwlimitHint')}>
          <div className="w-32">
            <Text
              value={typeof draft.bwlimit === 'string' ? draft.bwlimit : ''}
              onChange={(v) => patch({ bwlimit: v })}
              placeholder="1M"
              label={t('engine.bwlimit')}
              mono
            />
          </div>
        </SettingsRow>
        <SettingsRow label={t('engine.parallel')} hint={t('engine.parallelHint')}>
          <NumberField
            value={typeof draft.parallelJobs === 'number' ? draft.parallelJobs : 1}
            min={1}
            max={16}
            label={t('engine.parallel')}
            onChange={(v) => patch({ parallelJobs: v })}
          />
        </SettingsRow>
        <Field label={t('engine.history')} hint={t('engine.historyHint')}>
          <Text
            value={typeof draft.history === 'string' ? draft.history : ''}
            onChange={(v) => patch({ history: v })}
            placeholder="arrowloop-history.db"
            mono
          />
        </Field>
      </Card>

      {/* Engine-wide rather than a job default: patience after a failure
          depends on the machine, not on a folder pair. */}
      <Card title={t('workload.retries')} hint={t('retry.hint')} hueIndex={1}>
        <SettingsRow label={t('retry.attempts')} hint={t('retry.attemptsHint')}>
          <NumberField
            value={retry.attempts ?? 3}
            min={0}
            max={10}
            label={t('retry.attempts')}
            onChange={(v) => setRetry({ attempts: v })}
          />
        </SettingsRow>
        {/* Minutes, so nobody has to know the Go duration syntax. */}
        <SettingsRow label={`${t('retry.wait')} (${t('schedule.unit.minute')})`} hint={t('retry.waitHint')}>
          <NumberField
            value={waitMinutes(retry.wait)}
            min={1}
            max={1440}
            label={t('retry.wait')}
            onChange={(v) => setRetry({ wait: `${v}m` })}
          />
        </SettingsRow>
      </Card>
    </Stack>
  )
}
