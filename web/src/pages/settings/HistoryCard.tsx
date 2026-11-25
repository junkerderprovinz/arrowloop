import { useRef, useState } from 'react'

import { ConfirmWindow } from '../../components/ConfirmWindow'
import { NumberField } from '../../components/Field'
import { IconTrash } from '../../components/glyphs'
import { ToggleRow } from '../../components/ToggleRow'
import { api } from '../../lib/api'
import { errorText } from '../../lib/errorText'
import { Button } from '../../lib/glimstone/Button'
import { Card } from '../../lib/glimstone/Card'
import { keepDays, keepSetting } from '../../lib/historyKeep'
import { useT } from '../../lib/i18n'
import { useToast } from '../../lib/toast'
import { Reading, useEngineSettings } from './engineSettings'
import { SettingsRow } from './rows'

/** How long the history keeps a run, and a way to drop the older ones now. */
export function HistoryCard({ hueIndex }: { hueIndex: number }) {
  const { t } = useT()
  const push = useToast()
  const { loaded, draft, patch, error } = useEngineSettings()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  // The days to go back to when the switch is turned off again.
  const before = useRef<number | null>(null)
  if (!loaded) return <Reading title={t('nav.history')} error={error} hueIndex={hueIndex} />

  const days = keepDays(draft.historyKeep)
  const forever = days === 0

  async function remove() {
    setAsking(false)
    setBusy(true)
    try {
      const { runs } = await api.pruneHistory()
      push(t('history.deletedOld', { count: runs }))
    } catch (e) {
      push(errorText(t, e), 'fail')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t('nav.history')} hueIndex={hueIndex}>
      <ToggleRow
        label={t('history.keepForever')}
        hint={t('history.keepForeverHint')}
        checked={forever}
        onChange={(on) => {
          if (on) before.current = days
          patch({ historyKeep: keepSetting(on ? 0 : (before.current ?? keepDays(undefined))) })
        }}
      />
      {/* Absent rather than dimmed while every run is kept, as the other switches do it. */}
      {!forever && (
        <>
          <SettingsRow label={t('history.keep')} hint={t('history.keepHint')}>
            <NumberField
              value={days}
              min={0}
              max={36500}
              label={t('history.keep')}
              onChange={(next) => patch({ historyKeep: keepSetting(next) })}
            />
          </SettingsRow>
          <SettingsRow label={t('history.deleteOld')} hint={t('history.deleteOldHint', { days })}>
            <span className="flex flex-col items-end gap-1">
              <Button
                label={t('history.deleteOldButton')}
                labelKey="history.deleteOldButton"
                glyph={<IconTrash />}
                disabled={busy}
                onClick={() => setAsking(true)}
              />
              <span className="text-meta text-carbon-textMuted">{t('history.deleteOldStays')}</span>
            </span>
          </SettingsRow>
        </>
      )}
      {asking && (
        <ConfirmWindow
          title={t('history.deleteOld')}
          message={t('history.deleteOldQuestion', { days })}
          confirmLabel={t('history.deleteOldButton')}
          confirmLabelKey="history.deleteOldButton"
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setAsking(false)}
          onConfirm={() => void remove()}
        />
      )}
    </Card>
  )
}
