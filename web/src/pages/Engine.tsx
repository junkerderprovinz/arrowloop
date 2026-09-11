import { useCallback, useEffect, useRef, useState } from 'react'

import { Card } from '../lib/glimstone/Card'
import { Field, NumberField, Secret, Text } from '../components/Field'
import { Stack } from '../components/Shell'
import { ToggleRow } from '../components/ToggleRow'
import { QuietPeriod } from '../components/QuietPeriod'
import { ExcludeSetEditor, type Sets } from '../components/ExcludeSets'
import { Selector } from '../components/Selector'
import { api, type Settings } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * The settings that are not about one job.
 *
 * Every value on this page was already read by the engine and had nowhere to be
 * set except the configuration file itself. jdp, looking at the app: "Das
 * programm sieht so klein und unfertig aus und wirkt als haette es keine
 * funktionen." It had them. It just never showed them, which from the outside
 * is the same thing.
 *
 * Three cards rather than one long column, because these answer three different
 * questions: how hard may it work, how long does it remember, and who gets told.
 */

/**
 * The engine's settings, saved as they are changed.
 *
 * There was a save button at the foot of the page, and it is gone (jdp: "im
 * motortab gibt es einen speichern button. der soll weg. es soll alles live
 * speichern"). A page of settings is not a form somebody fills in and submits:
 * every control on it stands alone, and a button at the bottom means a switch
 * flipped at the top does nothing until somebody scrolls down and finds it. The
 * jobs page learned the same thing the hard way, where a deletion did not reach
 * the file until a button elsewhere was pressed.
 *
 * WRITING IS DELAYED, and that is not a detail. Half of these controls are text
 * boxes, so saving on every change would send a request per keystroke and, for
 * the bandwidth limit, would refuse "1" on the way to "1M" and flash an error at
 * somebody who is typing correctly. The delay lets a value settle first.
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

  /**
   * The pending write, held outside React's state on purpose.
   *
   * The timer's callback fires long after the render that scheduled it, so it
   * cannot close over `draft`: it would send whatever the draft was when the
   * FIRST character was typed. A ref is the value at the moment the timer runs.
   */
  const latest = useRef<Settings>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Cancels a pending write when the page is left mid-edit. */
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const commit = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      // The whole draft, not a diff. The endpoint merges, so sending a key back
      // unchanged costs nothing, and working out a diff is a second place for
      // "did this field change" to be decided differently from the first.
      const got = await api.saveSettings(latest.current)
      // `settings` takes the server's answer; the DRAFT deliberately does not.
      // A reply arriving while somebody is still typing would replace the box
      // under their cursor with the value they had a second ago.
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
          {/* Matrix first, because it is the one this house actually uses. */}
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
            {/* Covered in the field, shown by the eye. A token pasted into a
                plain box is a token on screen for as long as the page is. */}
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

      {/* What every job starts from, and the desktop could not set it at all:
          direction, mode and schedule have been defaults in the engine for a
          while and were reachable only from the phone or by editing the file.
          Same card, same name, same three axes on both surfaces. */}
      <Card title={t('engine.defaults')} hueIndex={2}>
        <div className="flex flex-col gap-4">
          <Field label={t('direction.label')} hint={t('defaults.followHint')}>
            <Selector<'both' | 'leftToRight' | 'rightToLeft'>
              scale="small"
              label={t('direction.label')}
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
          {/* Inert with `sync` showing for a both-ways default rather than
              vanishing, which is what the phone does and for the same reason: a
              card that changes shape with the answer above it is two cards
              somebody has to recognise as one. */}
          <Field
            label={t('mode.label')}
            hint={(defaults.direction ?? 'both') === 'both' ? t('mode.onlyOneWay') : undefined}
          >
            <Selector<'sync' | 'mirror' | 'move'>
              scale="small"
              label={t('mode.label')}
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

      {/* The global sync settings, in the same four groups the phone uses.
          jdp grouped them there after Autosync's own settings page, and the two
          surfaces naming the same things differently is how one product starts
          reading as two. Which is also why they are four cards rather than one
          long column: "how hard does it push" and "what is the net if it goes
          wrong" are different questions and were stacked in one list. */}
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
          {/* Three answers, not two, and the third one is the default. "Ask the
              two sides" is right for almost every job, and it is a genuinely
              different instruction from "never fold": a toggle could only offer
              two of the three and would have to pick which truth to hide. */}
          <Field label={t('engine.foldCase')} hint={t('engine.foldCaseHint')}>
            <Selector<'auto' | 'on' | 'off'>
              scale="small"
              label={t('engine.foldCase')}
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

      {/* The brakes get a card of their own because of what they are: the net
          that stops a run removing more than half of everything it knows
          about. Standing at the end of a list of transfer tuning, they read as
          two more numbers. */}
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

      {/* The explanation rides in the heading's own bubble rather than as a grey
          paragraph above the editor (jdp: "Info texte sollen immer in i
          infobubbles!"). That is rule 8, and this card was one of the three
          places in the app still printing its prose on the page: read once, then
          costing vertical space for ever, and hiding the control it was meant to
          clarify. */}
      <Card title={t('engine.sets')} hint={t('engine.setsHint')} hueIndex={4}>
        <div className="flex flex-col gap-3">
          <ExcludeSetEditor
            sets={(draft.excludeSets as Sets | undefined) ?? {}}
            onChange={(next) => patch({ excludeSets: next })}
          />
        </div>
      </Card>

      {/* The card that carried the whole setup in and out of a file used to sit
          here, and it has moved to the general section (jdp: "Eine Kopie der
          Einrichtung behalten-card in den allgemein tab"). It never belonged
          among these: this tab holds what the ENGINE reads, and that card is
          about the file holding all of it plus every job. It lives in
          components/SettingsBackup.tsx now. */}

      {/* What is left where the save button stood: the page says what it just
          did, and nothing here is a control. A refusal keeps its place, because
          an invalid bandwidth limit has to be seen and corrected, and it now
          arrives while the field is still in front of the person who typed it
          rather than on the next boot. */}
      {/* A REFUSAL STICKS TO THE BOTTOM OF THE WINDOW, and that is the price of
          taking the save button away. With a button, the answer appears where
          the finger just was; saving as you type puts the answer at the foot of
          a long page while the eye is on a field near the top. Measured on the
          running page: an invalid bandwidth limit is refused correctly, the
          value never reaches the file, and the sentence saying so was three
          cards below the fold.
          Only a refusal sticks. A line saying "saved" is not news worth pinning
          over the page, and a strip that is always there for a message that is
          usually empty is furniture. */}
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
