import { NumberField } from '../../components/Field'
import { Stack } from '../../components/Shell'
import type { Settings } from '../../lib/api'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { Reading, useEngineSettings } from './engineSettings'
import { SettingsRow } from './rows'

/**
 * The brakes, which hold a job whose run would remove or overwrite more than a
 * share of what it knows about.
 */
export function SafetyPage() {
  const { t } = useT()
  const { loaded, draft, patch, error } = useEngineSettings()
  if (!loaded) return <Reading title={t('settings.safetyNet')} error={error} />

  const defaults = draft.defaults ?? {}
  const setDefault = (next: Partial<NonNullable<Settings['defaults']>>) => patch({ defaults: { ...defaults, ...next } })

  return (
    <Stack>
      <Card title={t('safety.brakes')} hueIndex={0}>
        <SettingsRow label={t('engine.brakePercent')} hint={t('engine.brakePercentHint')}>
          <NumberField
            value={defaults.brakePercent ?? 50}
            min={0}
            max={100}
            label={t('engine.brakePercent')}
            onChange={(v) => setDefault({ brakePercent: v })}
          />
        </SettingsRow>
        <SettingsRow label={t('engine.changePercent')} hint={t('engine.changePercentHint')}>
          <NumberField
            value={defaults.changePercent ?? 50}
            min={0}
            max={100}
            label={t('engine.changePercent')}
            onChange={(v) => setDefault({ changePercent: v })}
          />
        </SettingsRow>
        <SettingsRow label={t('engine.brakeFloor')} hint={t('engine.brakeFloorHint')}>
          <NumberField
            value={defaults.brakeFloor ?? 10}
            min={0}
            max={100000}
            label={t('engine.brakeFloor')}
            onChange={(v) => setDefault({ brakeFloor: v })}
          />
        </SettingsRow>
      </Card>
    </Stack>
  )
}
