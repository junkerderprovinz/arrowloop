import type { ReactNode } from 'react'

import { ToggleRow } from '../../components/ToggleRow'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { setNavPin, useNavPins } from '../../lib/navPins'

/**
 * Targets always lives on its tile, the page whole under the switch that also
 * puts it in the sidebar. The cards go straight to the settings column, whose
 * page-top rule gives the first card's badge its room only there.
 */
export function TargetsTile({ page }: { page: ReactNode }) {
  const { t } = useT()
  const pinned = useNavPins().targets
  return (
    <>
      <Card title={t('nav.targets')} hueIndex={0}>
        <ToggleRow
          label={t('settings.showInSidebar')}
          hint={t('settings.showInSidebarHint')}
          checked={pinned}
          onChange={(on) => setNavPin('targets', on)}
        />
      </Card>
      {page}
    </>
  )
}
