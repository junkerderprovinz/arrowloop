import { Stack } from '../../components/Shell'
import { ToggleRow } from '../../components/ToggleRow'
import type { WindowSettings } from '../../lib/api'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { BackupCard } from './BackupCard'

/**
 * What concerns the app as a whole: this computer's window, start and updates
 * where there is a desktop app, and the settings backup everywhere.
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
          {/* Only the desktop app replaces itself. A container is updated the
              way it was deployed, and the phone through its store. */}
          <ToggleRow
            label={t('update.auto')}
            hint={t('update.autoHint')}
            checked={windowSettings.autoUpdate}
            onChange={(autoUpdate) => onWindow({ ...windowSettings, autoUpdate })}
          />
        </Card>
      )}

      <BackupCard hueIndex={windowSettings ? 1 : 0} />
    </Stack>
  )
}
