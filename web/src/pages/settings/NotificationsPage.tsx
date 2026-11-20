import { Stack } from '../../components/Shell'
import { useT } from '../../lib/i18n'
import { Reading, useEngineSettings } from './engineSettings'
import { NotifyCard } from './NotifyCard'

/** Where the engine reports a run: the channels it sends to and the services it checks in with. */
export function NotificationsPage() {
  const { t } = useT()
  const { loaded, draft, patch, error } = useEngineSettings()
  if (!loaded) return <Reading title={t('settings.notifications')} error={error} />

  return (
    <Stack>
      <div data-new="notify-tile">
        <div data-new="notify-channels">
          <NotifyCard notify={draft.notify ?? {}} setNotify={(next) => patch({ notify: next })} hueIndex={0} />
        </div>
      </div>
    </Stack>
  )
}
