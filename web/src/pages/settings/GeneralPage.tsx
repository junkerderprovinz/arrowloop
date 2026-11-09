import { FieldRow, NumberField, Text } from '../../components/Field'
import { Stack } from '../../components/Shell'
import { ToggleRow } from '../../components/ToggleRow'
import type { WindowSettings } from '../../lib/api'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { AutoBackupCard } from './AutoBackupCard'
import { BackupCard } from './BackupCard'
import { Reading, useEngineSettings } from './engineSettings'
import { SettingsRow } from './rows'

/**
 * What concerns the app as a whole: this computer's window and start where
 * there is a desktop app, the settings backups, and how hard the engine
 * may work on this machine.
 */
export function GeneralPage({
  window: windowSettings,
  onWindow,
}: {
  /** Null on a build with no window of its own. */
  window: WindowSettings | null
  onWindow: (next: WindowSettings) => void
}) {
  const { t } = useT()
  return (
    <Stack>
      {/* Left out rather than shown inert on a build with no window. */}
      {windowSettings && (
        <Card title={t('settings.thisComputer')} hueIndex={0}>
          <ToggleRow
            label={t('window.tray')}
            hint={t('window.trayHint')}
            checked={windowSettings.tray}
            onChange={(tray) => onWindow({ ...windowSettings, tray })}
          />
          {/* Both rely on the tray icon to bring a hidden window back. */}
          <ToggleRow
            label={t('window.close')}
            hint={t('window.closeHint')}
            checked={windowSettings.closeToTray}
            onChange={(closeToTray) => onWindow({ ...windowSettings, closeToTray })}
          />
          <ToggleRow
            label={t('window.minimise')}
            hint={t('window.minimiseHint')}
            checked={windowSettings.minimiseToTray}
            onChange={(minimiseToTray) => onWindow({ ...windowSettings, minimiseToTray })}
          />
          {/* Gated on the platform having an autostart mechanism, or the switch
              would report false however it is pressed. */}
          {windowSettings.canStartWithSystem && (
            <ToggleRow
              label={t('start.withSystem')}
              hint={t('start.withSystemHint')}
              checked={windowSettings.startWithSystem}
              onChange={(startWithSystem) => onWindow({ ...windowSettings, startWithSystem })}
            />
          )}
        </Card>
      )}

      <BackupCard hueIndex={windowSettings ? 1 : 0} />
      <AutoBackupCard hueIndex={windowSettings ? 2 : 1} />
      <WorkloadCard hueIndex={windowSettings ? 3 : 2} />
    </Stack>
  )
}

/** How hard the engine may work and where it writes its log of runs. */
function WorkloadCard({ hueIndex }: { hueIndex: number }) {
  const { t } = useT()
  const { loaded, draft, patch, error } = useEngineSettings()
  if (!loaded) return <Reading title={t('settings.workload')} error={error} hueIndex={hueIndex} />

  return (
    <Card title={t('settings.workload')} hueIndex={hueIndex}>
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
      <FieldRow label={t('engine.history')} hint={t('engine.historyHint')}>
        <Text
          value={typeof draft.history === 'string' ? draft.history : ''}
          onChange={(v) => patch({ history: v })}
          placeholder="arrowloop-history.db"
          label={t('engine.history')}
          mono
        />
      </FieldRow>
    </Card>
  )
}
