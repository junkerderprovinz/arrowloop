import { useCallback, useEffect, useRef, useState } from 'react'

import { Card } from '../lib/glimstone/Card'
import { Field, NumberField, Secret, Text } from '../components/Field'
import { Stack } from '../components/Shell'
import { ToggleRow } from '../components/ToggleRow'
import { QuietPeriod } from '../components/QuietPeriod'
import { ExcludeSetEditor, type Sets } from '../components/ExcludeSets'
import { HUE_OFFSET, Selector } from '../components/Selector'
import { api, type Settings } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * The engine settings that are not about one job, saved as they change.
 *
 * Writes wait for a value to settle, or a text box would send a request per
 * keystroke and the bandwidth limit would refuse "1" on the way to "1M".
 */
const SETTLE_MS = 700

function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Settings>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api
      .settings()
      .then((got) => {
        setSettings(got)
        setDraft(got)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  // A ref, because the timer fires long after the render that scheduled it and
  // would otherwise send a stale draft.
  const latest = useRef<Settings>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const commit = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      // The whole draft rather than a diff; the endpoint merges.
      const got = await api.saveSettings(latest.current)
      // Only `settings` takes the answer: replacing the draft would overwrite a
      // box somebody is still typing in.
      setSettings(got)
      setSaved(true)
    } catch (e) {
      setError((e as Error).message)
      setSaved(false)
    } finally {
      setBusy(false)
    }
  }, [])

  const patch = useCallback(
    (next: Partial<Settings>) => {
      setSaved(false)
      setDraft((prev) => {
        const merged = { ...prev, ...next }
        latest.current = merged
        return merged
      })
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void commit(), SETTLE_MS)
    },
    [commit],
  )

  return { settings, draft, patch, error, busy, saved }
}

export function Engine() {
  const { t } = useT()
  const { settings, draft, patch, error, busy, saved } = useSettings()

  if (settings === null) {
    return (
      <Card title={t('engine.title')} hueIndex={0}>
        <p className="text-xs text-carbon-textMuted">{error ?? t('engine.loading')}</p>
      </Card>
    )
  }

  const defaults = draft.defaults ?? {}
  const setDefault = (next: Partial<NonNullable<Settings['defaults']>>) =>
    patch({ defaults: { ...defaults, ...next } })
  const retry = draft.retry ?? {}
  const setRetry = (next: Partial<NonNullable<Settings['retry']>>) =>
    patch({ retry: { ...retry, ...next } })

  const matrix = draft.notify?.matrix ?? { homeserver: '', room: '', token: '' }
  const setMatrix = (next: Partial<typeof matrix>) =>
    patch({ notify: { ...draft.notify, matrix: { ...matrix, ...next } } })

  return (
    <Stack>
      <Card title={t('engine.work')} hueIndex={0}>
        <div className="flex flex-col gap-4">
          <Field label={t('engine.bwlimit')} hint={t('engine.bwlimitHint')}>
            <Text
              value={typeof draft.bwlimit === 'string' ? draft.bwlimit : ''}
              onChange={(v) => patch({ bwlimit: v })}
              placeholder="1M"
              mono
            />
          </Field>
          <Field label={t('engine.parallel')} hint={t('engine.parallelHint')}>
            <NumberField
              value={typeof draft.parallelJobs === 'number' ? draft.parallelJobs : 1}
              min={1}
              max={16}
              label={t('engine.parallel')}
              onChange={(v) => patch({ parallelJobs: v })}
            />
          </Field>
        </div>
      </Card>

      <Card title={t('engine.memory')} hueIndex={1}>
        <Field label={t('engine.history')} hint={t('engine.historyHint')}>
          <Text
            value={typeof draft.history === 'string' ? draft.history : ''}
            onChange={(v) => patch({ history: v })}
            placeholder="arrowloop-history.db"
            mono
          />
        </Field>
      </Card>

      <Card title={t('engine.telling')} hueIndex={2}>
        <div className="flex flex-col gap-4">
          <Field label={t('engine.matrixHome')} hint={t('engine.matrixHint')}>
            <Text
              value={matrix.homeserver}
              onChange={(v) => setMatrix({ homeserver: v })}
              placeholder="https://matrix.example.org"
              mono
            />
          </Field>
          <Field label={t('engine.matrixRoom')}>
            <Text value={matrix.room} onChange={(v) => setMatrix({ room: v })} placeholder="!abc:example.org" mono />
          </Field>
          <Field label={t('engine.matrixToken')}>
            <Secret value={matrix.token} onChange={(v) => setMatrix({ token: v })} />
          </Field>
          <Field label={t('engine.webhook')} hint={t('engine.webhookHint')}>
            <Text
              value={typeof draft.notify?.webhook === 'string' ? draft.notify.webhook : ''}
              onChange={(v) => patch({ notify: { ...draft.notify, webhook: v } })}
              placeholder="https://example.org/hook"
              mono
            />
          </Field>
          <ToggleRow
            label={t('engine.onSuccess')}
            checked={!!draft.notify?.onSuccess}
            onChange={(v) => patch({ notify: { ...draft.notify, onSuccess: v } })}
            hint={t('engine.onSuccessHint')}
          />
        </div>
      </Card>

      {/* What every new job starts from, the same card as on the phone. */}
      <Card title={t('engine.defaults')} hueIndex={2}>
        <div className="flex flex-col gap-4">
          <Field label={t('direction.label')} hint={t('defaults.followHint')}>
            <Selector<'both' | 'leftToRight' | 'rightToLeft'>
              scale="small"
              label={t('direction.label')}
              hueOffset={HUE_OFFSET.direction}
              value={(defaults.direction as 'both' | 'leftToRight' | 'rightToLeft') ?? 'both'}
              onChange={(direction) =>
                setDefault({ direction, mode: direction === 'both' ? 'sync' : defaults.mode })
              }
              options={[
                { value: 'both', label: t('direction.both') },
                { value: 'leftToRight', label: t('direction.toRight') },
                { value: 'rightToLeft', label: t('direction.toLeft') },
              ]}
            />
          </Field>
          {/* Inert and showing `sync` for a both-ways default rather than
              vanishing, so the card keeps its shape, as on the phone. */}
          <Field
            label={t('mode.label')}
            hint={(defaults.direction ?? 'both') === 'both' ? t('mode.onlyOneWay') : undefined}
          >
            <Selector<'sync' | 'mirror' | 'move'>
              scale="small"
              label={t('mode.label')}
              hueOffset={HUE_OFFSET.mode}
              disabled={(defaults.direction ?? 'both') === 'both'}
              value={
                (defaults.direction ?? 'both') === 'both'
                  ? 'sync'
                  : ((defaults.mode as 'sync' | 'mirror' | 'move') ?? 'sync')
              }
              onChange={(mode) => setDefault({ mode })}
              options={[
                { value: 'sync', label: t('mode.sync') },
                { value: 'mirror', label: t('mode.mirror') },
                { value: 'move', label: t('mode.move') },
              ]}
            />
          </Field>
          <Field label={t('edit.schedule')} hint={t('edit.scheduleHint')}>
            <Text
              value={defaults.schedule ?? ''}
              onChange={(schedule) => setDefault({ schedule })}
              placeholder="0 3 * * *"
              mono
            />
          </Field>
        </div>
      </Card>

      {/* The global sync settings, in the same groups the phone uses. */}
      <Card title={t('settings.transfer')} hueIndex={3}>
        <div className="flex flex-col gap-4">
          <Field label={t('engine.transfers')} hint={t('engine.transfersHint')}>
            <NumberField
              value={defaults.transfers ?? 4}
              min={1}
              max={64}
              label={t('engine.transfers')}
              onChange={(v) => setDefault({ transfers: v })}
            />
          </Field>
          <Field label={t('edit.quietPeriod')} hint={t('edit.quietHint')}>
            <QuietPeriod
              value={defaults.quietPeriod ?? ''}
              onChange={(v) => setDefault({ quietPeriod: v })}
            />
          </Field>
          <Field label={t('engine.modWindow')} hint={t('engine.modWindowHint')}>
            <Text
              value={defaults.modWindow ?? ''}
              onChange={(v) => setDefault({ modWindow: v })}
              placeholder="1s"
              mono
            />
          </Field>
        </div>
      </Card>

      <Card title={t('settings.contents')} hueIndex={4}>
        <div className="flex flex-col gap-4">
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
          {/* Three answers rather than a toggle, since the default "ask the two
              sides" differs from "never fold". */}
          <Field label={t('engine.foldCase')} hint={t('engine.foldCaseHint')}>
            <Selector<'auto' | 'on' | 'off'>
              scale="small"
              label={t('engine.foldCase')}
              hueOffset={HUE_OFFSET.foldCase}
              value={defaults.foldCase === undefined ? 'auto' : defaults.foldCase ? 'on' : 'off'}
              onChange={(next) =>
                setDefault({ foldCase: next === 'auto' ? undefined : next === 'on' })
              }
              options={[
                { value: 'auto', label: t('engine.foldAuto') },
                { value: 'on', label: t('engine.foldOn') },
                { value: 'off', label: t('engine.foldOff') },
              ]}
            />
          </Field>
        </div>
      </Card>

      {/* The brakes stop a run from removing more than a share of what it knows
          about, so they get a card of their own. */}
      <Card title={t('settings.safetyNet')} hueIndex={5}>
        <div className="flex flex-col gap-4">
          <Field label={t('engine.brakePercent')} hint={t('engine.brakePercentHint')}>
            <NumberField
              value={defaults.brakePercent ?? 50}
              min={0}
              max={100}
              label={t('engine.brakePercent')}
              onChange={(v) => setDefault({ brakePercent: v })}
            />
          </Field>
          <Field label={t('engine.brakeFloor')} hint={t('engine.brakeFloorHint')}>
            <NumberField
              value={defaults.brakeFloor ?? 10}
              min={0}
              max={100000}
              label={t('engine.brakeFloor')}
              onChange={(v) => setDefault({ brakeFloor: v })}
            />
          </Field>
        </div>
      </Card>

      {/* Retries after a failed scheduled run. Engine-wide rather than a job
          default: patience after a failure depends on the machine, not on a
          folder pair. */}
      <Card title={t('settings.retry')} hint={t('retry.hint')} hueIndex={6}>
        <div className="flex flex-col gap-4">
          <Field label={t('retry.attempts')} hint={t('retry.attemptsHint')}>
            <NumberField
              value={retry.attempts ?? 3}
              min={0}
              max={10}
              label={t('retry.attempts')}
              onChange={(v) => setRetry({ attempts: v })}
            />
          </Field>
          {/* Minutes, so nobody has to know the Go duration syntax. */}
          <Field
            label={`${t('retry.wait')} (${t('schedule.unit.minute')})`}
            hint={t('retry.waitHint')}
          >
            <NumberField
              value={waitMinutes(retry.wait)}
              min={1}
              max={1440}
              label={t('retry.wait')}
              onChange={(v) => setRetry({ wait: `${v}m` })}
            />
          </Field>
        </div>
      </Card>

      <Card title={t('engine.sets')} hint={t('engine.setsHint')} hueIndex={4}>
        <div className="flex flex-col gap-3">
          <ExcludeSetEditor
            sets={(draft.excludeSets as Sets | undefined) ?? {}}
            onChange={(next) => patch({ excludeSets: next })}
          />
        </div>
      </Card>

      {/* The save status. A refusal sticks to the bottom of the window, since
          the field that caused it may be far up a long page; "saved" does not. */}
      <div
        className={`flex min-h-4 flex-wrap items-center justify-end gap-2 text-xs ${
          error ? 'sticky bottom-0 -mx-2 rounded-card bg-carbon-surface px-2 py-1.5 shadow-lg' : ''
        }`}
      >
        {error ? (
          <p className="me-auto text-statusFail">{error}</p>
        ) : busy ? (
          <p className="me-auto text-carbon-textMuted">{t('engine.saving')}</p>
        ) : saved ? (
          <p className="me-auto text-statusOk">{t('engine.savedLive')}</p>
        ) : null}
      </div>
    </Stack>
  )
}

/**
 * The stored retry wait, a Go duration, as whole minutes. Anything unreadable
 * shows the engine's built-in default, which is what then applies.
 */
function waitMinutes(raw: string | undefined): number {
  const match = /^(\d+)(m|h)$/.exec(raw ?? '')
  if (!match) return 5
  const n = Number(match[1])
  return match[2] === 'h' ? n * 60 : n
}
