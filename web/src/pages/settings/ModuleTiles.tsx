import type { ReactNode } from 'react'

import { NumberField } from '../../components/Field'
import { ToggleRow } from '../../components/ToggleRow'
import type { Settings } from '../../lib/api'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { setNavPin, useNavPins } from '../../lib/navPins'
import type { ModuleId } from '../../lib/routes'
import { Reading, useEngineSettings } from './engineSettings'
import { OpenPageRow, SettingsRow } from './rows'

// A page that can stand in the sidebar always keeps its tile. While it is
// pinned the tile holds only its settings and the way to the page, so nothing
// shows twice; unpinned, the tile draws the whole page under them.

function SidebarRows({ id, label }: { id: ModuleId; label: string }) {
  const { t } = useT()
  const pinned = useNavPins()[id]
  return (
    <>
      <ToggleRow
        label={t('settings.showInSidebar')}
        hint={t('settings.showInSidebarHint')}
        checked={pinned}
        onChange={(on) => setNavPin(id, on)}
      />
      {pinned && <OpenPageRow label={label} to={`/${id}`} />}
    </>
  )
}

export function TargetsTile({ page }: { page: ReactNode }) {
  const { t } = useT()
  const pinned = useNavPins().targets
  return (
    <div className="flex flex-col gap-10">
      <div data-new="targets-tile">
        <Card title={t('nav.targets')} hueIndex={0}>
          <SidebarRows id="targets" label={t('nav.targets')} />
        </Card>
      </div>
      {!pinned && page}
    </div>
  )
}

/** The anomaly settings live here whether or not the page is pinned, since the page has none. */
export function AnomaliesTile({ page }: { page: ReactNode }) {
  const { t } = useT()
  const pinned = useNavPins().anomalies
  const { loaded, draft, patch, error } = useEngineSettings()
  if (!loaded) return <Reading title={t('nav.anomalies')} error={error} />

  const anomalies = draft.anomalies ?? {}
  const set = (next: Partial<NonNullable<Settings['anomalies']>>) => patch({ anomalies: { ...anomalies, ...next } })

  return (
    <div className="flex flex-col gap-10">
      <div data-new="anomalies-tile">
        <Card title={t('nav.anomalies')} hueIndex={0}>
          <SettingsRow label={t('anomaly.failingAfter')} hint={t('anomaly.failingAfterHint')}>
            <NumberField
              value={anomalies.failingAfter ?? 3}
              min={0}
              max={50}
              label={t('anomaly.failingAfter')}
              onChange={(v) => set({ failingAfter: v })}
            />
          </SettingsRow>
          <SettingsRow label={t('anomaly.overdueDays')} hint={t('anomaly.overdueDaysHint')}>
            <NumberField
              value={anomalies.overdueDays ?? 2}
              min={0}
              max={365}
              label={t('anomaly.overdueDays')}
              onChange={(v) => set({ overdueDays: v })}
            />
          </SettingsRow>
          <ToggleRow
            label={t('anomaly.notifyHeld')}
            checked={anomalies.notifyHeld ?? true}
            onChange={(v) => set({ notifyHeld: v })}
            hint={t('anomaly.notifyHeldHint')}
          />
          <ToggleRow
            label={t('anomaly.notifyNotes')}
            checked={!!anomalies.notifyNotes}
            onChange={(v) => set({ notifyNotes: v })}
            hint={t('anomaly.notifyNotesHint')}
          />
          <SidebarRows id="anomalies" label={t('nav.anomalies')} />
        </Card>
      </div>
      {!pinned && page}
    </div>
  )
}
