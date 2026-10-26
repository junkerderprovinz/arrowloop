import { ExceptionsCard, useExceptions } from '../../components/Exceptions'
import { ExcludeSetEditor, type Sets } from '../../components/ExcludeSets'
import { NumberField, Text } from '../../components/Field'
import { QuietPeriod } from '../../components/QuietPeriod'
import { ScheduleDetails, ScheduleKinds, useSchedule } from '../../components/Schedule'
import { Selector } from '../../components/Selector'
import { Stack } from '../../components/Shell'
import { ToggleRow } from '../../components/ToggleRow'
import type { Settings } from '../../lib/api'
import { SYNC_SETTINGS } from '../../lib/follows'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { modesHint } from '../../lib/modes'
import { Reading, useEngineSettings, waitMinutes } from './engineSettings'
import { counter, SettingsRow } from './rows'

type Direction = 'both' | 'leftToRight' | 'rightToLeft'
type Mode = 'sync' | 'mirror' | 'move'

/**
 * What every job starts from, how it moves and compares files, the jobs that
 * differ from it, how often a failed run is tried again, and the lists of
 * patterns jobs leave out.
 */
export function SyncPage() {
  const { t } = useT()
  const { loaded, draft, patch, error } = useEngineSettings()
  const exceptions = useExceptions(SYNC_SETTINGS)
  if (!loaded) return <Reading title={t('engine.defaults')} error={error} />

  const defaults = draft.defaults ?? {}
  const setDefault = (next: Partial<NonNullable<Settings['defaults']>>) => patch({ defaults: { ...defaults, ...next } })
  const direction: Direction = (defaults.direction as Direction | undefined) ?? 'both'
  const retry = draft.retry ?? {}
  const setRetry = (next: Partial<NonNullable<Settings['retry']>>) => patch({ retry: { ...retry, ...next } })
  const selectorHue = counter()
  const cardHue = counter()

  return (
    <Stack>
      <Card title={t('engine.defaults')} hint={t('settings.syncHint')} hueIndex={cardHue()}>
        <SettingsRow label={t('direction.label')} hint={t('defaults.followHint')}>
          <Selector<Direction>
            scale="small"
            low
            hug
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
            low
            hug
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
        <DefaultSchedule value={defaults.schedule ?? ''} hue={selectorHue()} onChange={(schedule) => setDefault({ schedule })} />
      </Card>

      <Card title={t('settings.transfer')} hueIndex={cardHue()}>
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
          {/* Unset is the engine's five seconds, and zero is written as 0s,
              since an empty value would mean those five seconds again. */}
          <QuietPeriod value={defaults.quietPeriod || '5s'} onChange={(v) => setDefault({ quietPeriod: v || '0s' })} />
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

      <Card title={t('settings.contents')} hueIndex={cardHue()}>
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
            low
            hug
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

      {exceptions.list.length > 0 && <ExceptionsCard exceptions={exceptions} hueIndex={cardHue()} />}

      {/* Engine-wide rather than a job default: patience after a failure
          depends on the machine, not on a folder pair. */}
      <Card title={t('workload.retries')} hint={t('retry.hint')} hueIndex={cardHue()}>
        <SettingsRow label={t('retry.attempts')} hint={t('retry.attemptsHint')}>
          <NumberField
            value={retry.attempts ?? 3}
            min={0}
            max={10}
            label={t('retry.attempts')}
            onChange={(v) => setRetry({ attempts: v })}
          />
        </SettingsRow>
        {/* Minutes, so nobody has to know the Go duration syntax. */}
        <SettingsRow label={`${t('retry.wait')} (${t('schedule.unit.minute')})`} hint={t('retry.waitHint')}>
          <NumberField
            value={waitMinutes(retry.wait)}
            min={1}
            max={1440}
            label={t('retry.wait')}
            onChange={(v) => setRetry({ wait: `${v}m` })}
          />
        </SettingsRow>
      </Card>

      <Card title={t('engine.sets')} hint={t('engine.setsHint')} hueIndex={cardHue()}>
        <ExcludeSetEditor
          sets={(draft.excludeSets as Sets | undefined) ?? {}}
          onChange={(next) => patch({ excludeSets: next })}
        />
      </Card>
    </Stack>
  )
}

/**
 * The schedule every job starts from: its kinds at the end of the row like the
 * selectors above it, and the fields of the chosen kind below.
 */
function DefaultSchedule({ value, hue, onChange }: { value: string; hue: number; onChange: (next: string) => void }) {
  const { t } = useT()
  const editor = useSchedule({ value, onChange: (next) => onChange(next.schedule) })
  return (
    <>
      <SettingsRow label={t('edit.schedule')} hint={t('edit.scheduleHint')}>
        <span data-new="schedule-hs" className="flex max-w-full">
          <ScheduleKinds editor={editor} hue={hue} />
        </span>
      </SettingsRow>
      <ScheduleDetails editor={editor} />
    </>
  )
}
