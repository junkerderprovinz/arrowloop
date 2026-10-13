import { NumberField } from '../../components/Field'
import { Stack } from '../../components/Shell'
import { ToggleRow } from '../../components/ToggleRow'
import type { Settings } from '../../lib/api'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { Reading, useEngineSettings } from './engineSettings'
import { NotifyCard } from './NotifyCard'
import { SettingsRow } from './rows'

/**
 * What keeps a job from doing harm and who hears of it: the brakes, which
 * hold a run that would remove or overwrite more than a share of what the job
 * knows about, the anomaly notes, and when and where the engine reports.
 */
export function SafetyPage() {
  const { t } = useT()
  const { loaded, draft, patch, error } = useEngineSettings()
  if (!loaded) return <Reading title={t('safety.brakes')} error={error} />

  const defaults = draft.defaults ?? {}
  const setDefault = (next: Partial<NonNullable<Settings['defaults']>>) => patch({ defaults: { ...defaults, ...next } })
  const anomalies = draft.anomalies ?? {}
  const setAnomalies = (next: Partial<NonNullable<Settings['anomalies']>>) => patch({ anomalies: { ...anomalies, ...next } })
  const notify = draft.notify ?? {}
  const on = !anomalies.off

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

      <div data-new="anomalies-module">
        <Card title={t('nav.anomalies')} hueIndex={1}>
          <ToggleRow
            label={t('nav.anomalies')}
            hint={t('anomaly.moduleHint')}
            checked={on}
            onChange={(next) => setAnomalies({ off: !next })}
          />
          {/* The notes only mean something while the switch is on, so they
              are absent rather than dimmed when it is off. A held job is
              still told, since the brakes hold whatever the switch says. */}
          {on && (
            <>
              <SettingsRow label={t('anomaly.failingAfter')} hint={t('anomaly.failingAfterHint')}>
                <NumberField
                  value={anomalies.failingAfter ?? 3}
                  min={0}
                  max={50}
                  label={t('anomaly.failingAfter')}
                  onChange={(v) => setAnomalies({ failingAfter: v })}
                />
              </SettingsRow>
              <SettingsRow label={t('anomaly.overdueDays')} hint={t('anomaly.overdueDaysHint')}>
                <span className="flex items-center gap-2">
                  <NumberField
                    value={anomalies.overdueDays ?? 2}
                    min={0}
                    max={365}
                    label={t('anomaly.overdueDays')}
                    onChange={(v) => setAnomalies({ overdueDays: v })}
                  />
                  <span className="text-body text-carbon-textSub">{t('anomaly.daysLate')}</span>
                </span>
              </SettingsRow>
              <ToggleRow
                label={t('anomaly.unusual')}
                hint={t('anomaly.unusualHint')}
                checked={anomalies.unusual ?? true}
                onChange={(v) => setAnomalies({ unusual: v })}
              />
            </>
          )}
          <ToggleRow
            label={t('anomaly.notifyHeld')}
            checked={anomalies.notifyHeld ?? true}
            onChange={(v) => setAnomalies({ notifyHeld: v })}
            hint={t('anomaly.notifyHeldHint')}
          />
          {on && (
            <ToggleRow
              label={t('anomaly.notifyNotes')}
              checked={!!anomalies.notifyNotes}
              onChange={(v) => setAnomalies({ notifyNotes: v })}
              hint={t('anomaly.notifyNotesHint')}
            />
          )}
        </Card>
      </div>

      <div data-new="notify-channels">
        <NotifyCard notify={notify} setNotify={(next) => patch({ notify: next })} hueIndex={2} />
      </div>
    </Stack>
  )
}
