import { Field, NumberField, Text } from '../../components/Field'
import { QuietPeriod } from '../../components/QuietPeriod'
import { Selector } from '../../components/Selector'
import { Stack } from '../../components/Shell'
import { ToggleRow } from '../../components/ToggleRow'
import type { Settings } from '../../lib/api'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { modesHint } from '../../lib/modes'
import { Reading, useEngineSettings } from './engineSettings'
import { counter, SettingsRow } from './rows'

type Direction = 'both' | 'leftToRight' | 'rightToLeft'
type Mode = 'sync' | 'mirror' | 'move'

/** What every job starts from, and how it moves and compares files. */
export function SyncPage() {
  const { t } = useT()
  const { loaded, draft, patch, error } = useEngineSettings()
  if (!loaded) return <Reading title={t('engine.defaults')} error={error} />

  const defaults = draft.defaults ?? {}
  const setDefault = (next: Partial<NonNullable<Settings['defaults']>>) => patch({ defaults: { ...defaults, ...next } })
  const direction: Direction = (defaults.direction as Direction | undefined) ?? 'both'
  const selectorHue = counter()

  return (
    <Stack>
      <Card title={t('engine.defaults')} hint={t('settings.syncHint')} hueIndex={0}>
        <SettingsRow label={t('direction.label')} hint={t('defaults.followHint')}>
          <Selector<Direction>
            scale="small"
            label={t('direction.label')}
            hue={selectorHue()}
            value={direction}
            onChange={(next) => setDefault({ direction: next, mode: next === 'both' ? 'sync' : defaults.mode })}
            options={[
              { value: 'both', label: t('direction.both') },
              { value: 'leftToRight', label: t('direction.toRight') },
              { value: 'rightToLeft', label: t('direction.toLeft') },
            ]}
          />
        </SettingsRow>
        {/* Inert and showing `sync` for a both-ways default rather than
            vanishing, so the card keeps its shape, as on the phone. While the
            strip cannot be reached, the label's bubble says why and explains
            all three. */}
        <SettingsRow
          label={t('mode.label')}
          hint={direction === 'both' ? `${t('mode.onlyOneWay')} ${modesHint(t)}` : undefined}
        >
          <Selector<Mode>
            scale="small"
            label={t('mode.label')}
            hue={selectorHue()}
            disabled={direction === 'both'}
            value={direction === 'both' ? 'sync' : ((defaults.mode as Mode | undefined) ?? 'sync')}
            onChange={(mode) => setDefault({ mode })}
            options={[
              { value: 'sync', label: t('mode.sync'), hint: t('mode.syncHint') },
              { value: 'mirror', label: t('mode.mirror'), hint: t('mode.mirrorHint') },
              { value: 'move', label: t('mode.move'), hint: t('mode.moveHint') },
            ]}
          />
        </SettingsRow>
        <Field label={t('edit.schedule')} hint={t('edit.scheduleHint')}>
          <Text
            value={defaults.schedule ?? ''}
            onChange={(schedule) => setDefault({ schedule })}
            placeholder="0 3 * * *"
            mono
          />
        </Field>
      </Card>

      <Card title={t('settings.transfer')} hueIndex={1}>
        <SettingsRow label={t('engine.transfers')} hint={t('engine.transfersHint')}>
          <NumberField
            value={defaults.transfers ?? 4}
            min={1}
            max={64}
            label={t('engine.transfers')}
            onChange={(v) => setDefault({ transfers: v })}
          />
        </SettingsRow>
        <SettingsRow label={t('edit.quietPeriod')} hint={t('edit.quietHint')}>
          <QuietPeriod value={defaults.quietPeriod ?? ''} onChange={(v) => setDefault({ quietPeriod: v })} />
        </SettingsRow>
        <SettingsRow label={t('engine.modWindow')} hint={t('engine.modWindowHint')}>
          <div className="w-32">
            <Text
              value={defaults.modWindow ?? ''}
              onChange={(v) => setDefault({ modWindow: v })}
              placeholder="1s"
              label={t('engine.modWindow')}
              mono
            />
          </div>
        </SettingsRow>
      </Card>

      <Card title={t('settings.contents')} hueIndex={2}>
        <ToggleRow
          label={t('edit.emptyDirs')}
          checked={!!defaults.emptyDirs}
          onChange={(v) => setDefault({ emptyDirs: v })}
          hint={t('edit.emptyDirsHint')}
        />
        <ToggleRow
          label={t('edit.metadata')}
          checked={!!defaults.metadata}
          onChange={(v) => setDefault({ metadata: v })}
          hint={t('edit.metadataHint')}
        />
        {/* Three answers rather than a switch, since the default "ask the two
            sides" differs from "never fold". */}
        <SettingsRow label={t('engine.foldCase')} hint={t('engine.foldCaseHint')}>
          <Selector<'auto' | 'on' | 'off'>
            scale="small"
            label={t('engine.foldCase')}
            hue={selectorHue()}
            value={defaults.foldCase === undefined ? 'auto' : defaults.foldCase ? 'on' : 'off'}
            onChange={(next) => setDefault({ foldCase: next === 'auto' ? undefined : next === 'on' })}
            options={[
              { value: 'auto', label: t('engine.foldAuto') },
              { value: 'on', label: t('engine.foldOn') },
              { value: 'off', label: t('engine.foldOff') },
            ]}
          />
        </SettingsRow>
      </Card>
    </Stack>
  )
}
