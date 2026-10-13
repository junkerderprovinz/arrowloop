import type { ReactNode } from 'react'

import { ToggleRow } from '../../components/ToggleRow'
import { Button } from '../../lib/glimstone/Button'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { setNavPin, useNavPins } from '../../lib/navPins'
import { navigate } from '../../lib/router'
import { useTargetCount } from '../../lib/targetCount'
import { SettingsRow } from './rows'

/**
 * Targets on its tile: the sidebar switch and what is saved in one card, and
 * under it the page whole while the page is not in the sidebar. Pinned, the
 * page is set up where the sidebar leads, so the tile shows only the card and
 * a way there, and nothing stands in two places.
 */
export function TargetsTile({ page }: { page: ReactNode }) {
  const { t } = useT()
  const pinned = useNavPins().targets
  const count = useTargetCount()
  return (
    <>
      <Card title={t('targets.pageCard')} hueIndex={0}>
        <ToggleRow
          label={t('settings.showInSidebar')}
          hint={t('settings.showInSidebarHint')}
          checked={pinned}
          onChange={(on) => setNavPin('targets', on)}
        />
        <SettingsRow label={t('nav.targets')}>
          <span className="flex items-center gap-3">
            <Count value={count?.targets} />
            {pinned && <Button label={t('settings.open')} labelKey="settings.open" onClick={() => navigate('/targets')} />}
          </span>
        </SettingsRow>
        <SettingsRow label={t('targets.drives')}>
          <Count value={count?.drives} />
        </SettingsRow>
      </Card>
      {!pinned && page}
    </>
  )
}

/** A failed read leaves the number out; the page says what went wrong. */
function Count({ value }: { value: number | undefined }) {
  return <span className="glim-num text-body text-carbon-textSub">{value ?? ''}</span>
}
