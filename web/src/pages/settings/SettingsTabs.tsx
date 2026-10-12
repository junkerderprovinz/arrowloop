import { Selector } from '../../components/Selector'
import { useT } from '../../lib/i18n'
import { navigate } from '../../lib/router'
import type { TabId } from '../../lib/routes'
import type { SettingsTab } from './tabs'

/**
 * The settings pages as a strip of tabs across the page, the one horizontal
 * selector with a glyph on every tab. Each tab keeps the rainbow position of
 * its place, and choosing one opens its address, so back and forward step
 * through the tabs as through any page.
 */
export function SettingsTabs({ tabs, active }: { tabs: SettingsTab[]; active: TabId }) {
  const { t } = useT()
  return (
    <div data-new="settings-tabs" className="w-full">
      <Selector<TabId>
        variant="chip"
        label={t('settings.tiles')}
        value={active}
        onChange={(id) => navigate(`/settings/${id}`)}
        options={tabs.map((tab) => {
          const Icon = tab.icon
          return { value: tab.id, label: t(tab.labelKey), icon: <Icon /> }
        })}
      />
    </div>
  )
}
