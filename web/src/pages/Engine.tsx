import { useCallback, useEffect, useState } from 'react'

import { Card } from '../lib/glimstone/Card'
import { Field, NumberField, Secret, Text } from '../components/Field'
import { Stack } from '../components/Shell'
import { ToggleRow } from '../components/ToggleRow'
import { Button } from '../lib/glimstone/Button'
import { IconSave } from '../components/glyphs'
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

/** One draft of the settings, saved as a whole rather than field by field. */
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

  const patch = useCallback((next: Partial<Settings>) => {
    setSaved(false)
    setDraft((prev) => ({ ...prev, ...next }))
  }, [])

  const save = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      // The whole draft, not a diff. The endpoint merges, so sending a key back
      // unchanged costs nothing, and working out a diff is a second place for
      // "did this field change" to be decided differently from the first.
      const got = await api.saveSettings(draft)
      setSettings(got)
      setDraft(got)
      setSaved(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [draft])

  return { settings, draft, patch, save, error, busy, saved }
}

export function Engine() {
  const { t } = useT()
  const { settings, draft, patch, save, error, busy, saved } = useSettings()

  if (settings === null) {
    return (
      <Card title={t('engine.title')} hueIndex={0}>
        <p className="text-xs text-carbon-textMuted">{error ?? t('engine.loading')}</p>
      </Card>
    )
  }

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

      <div className="flex flex-wrap items-center justify-end gap-2">
        {error && <p className="me-auto text-xs text-statusFail">{error}</p>}
        {saved && !error && <p className="me-auto text-xs text-statusOk">{t('edit.savedNote')}</p>}
        <Button
          label={t('edit.save')}
          labelKey={null}
          glyph={<IconSave />}
          tone="accent"
          busy={busy}
          disabled={busy}
          onClick={() => void save()}
        />
      </div>
    </Stack>
  )
}
