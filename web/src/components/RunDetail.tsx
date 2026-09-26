import { useEffect, useState } from 'react'

import { Badge } from '../lib/glimstone/Badge'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { api, type Resolution, type RunEntry } from '../lib/api'
import { entryLabel } from '../lib/entryLabel'
import { usePlaces } from '../lib/places'
import { useT } from '../lib/i18n'
import { Choice } from './Field'
import { Button } from '../lib/glimstone/Button'
import { IconCopy, IconSave } from './glyphs'
import { download } from '../lib/download'

/**
 * What one run did, path by path, fetched when the run is opened.
 *
 * A scheduled run resolves every conflict by keeping both versions, since it
 * cannot choose for anybody; this is where that choice can be revisited.
 */

// Codepoints rather than escapes: a tab mangled into a space still looks right
// but breaks the columns.
const TAB = String.fromCharCode(9)
const NEWLINE = String.fromCharCode(10)

/** Which kinds are a problem, so a failed run's own lines stand out in it. */
function tone(kind: string): 'ok' | 'warn' | 'fail' | 'neutral' {
  if (kind === 'skip') return 'fail'
  if (kind === 'conflict') return 'warn'
  return 'neutral'
}

export function RunDetail({
  run,
  job,
  onResolved,
}: {
  run: number
  job: string
  /** Called after conflict choices have started a new run. */
  onResolved: () => void
}) {
  const { t } = useT()
  const { jobs, drives } = usePlaces()
  const config = jobs.find((j) => j.name === job)
  const [entries, setEntries] = useState<RunEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [choices, setChoices] = useState<Record<string, Resolution>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setEntries(null)
    setError(null)
    api
      .runEntries(run)
      .then((got) => {
        if (live) setEntries(got)
      })
      .catch((e: Error) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [run])

  if (error) return <p className="py-2 text-xs text-statusFail">{error}</p>
  if (entries === null) return <p className="py-2 text-xs text-carbon-textMuted">{t('history.loading')}</p>
  if (entries.length === 0) return <p className="py-2 text-xs text-carbon-textMuted">{t('history.nothing')}</p>

  const conflicts = entries.filter((e) => e.Kind === 'conflict')
  const picked = Object.entries(choices).filter(([, v]) => v !== 'both')

  return (
    <div className="glim-content-fade flex flex-col gap-2 pb-3">
      {/* Tab-separated plain text, so a run that went wrong can be sent on. */}
      <div className="flex justify-end">
        <Button
          label={t('history.download')}
          labelKey="history.download"
          glyph={<IconCopy />}
          onClick={() => {
            const lines = entries.map((e) => [e.Kind, e.Side, e.Path, e.Note].join(TAB))
            download(`arrowloop-${job}-${run}.txt`, lines.join(NEWLINE) + NEWLINE)
          }}
        />
      </div>

      <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
        {entries.map((e, i) => (
          <li key={`${e.Path}-${i}`} className="flex items-start gap-2 text-xs">
            <Badge tone={tone(e.Kind)}>{entryLabel(t, e, config, drives)}</Badge>
            <span className="min-w-0 flex-1 break-all font-mono text-carbon-text" title={e.Path}>
              {e.Path}
            </span>
            {e.Note && (
              <span className="min-w-0 max-w-[45%] shrink-0 text-carbon-textMuted" title={e.Note}>
                {e.Note}
              </span>
            )}
          </li>
        ))}
      </ul>

      {conflicts.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* Choosing starts a fresh run for these paths, so the record of the
              first run stays as it was. */}
          <span className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-carbon-textMuted">
            {t('conflict.title')}
            <InfoBubble tip={t('history.conflictHint')} />
          </span>
          {conflicts.map((c) => (
            <div key={c.Path} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 break-all font-mono text-xs" title={c.Path}>
                {c.Path}
              </span>
              <div className="w-44 shrink-0">
                <Choice<Resolution>
                  value={choices[c.Path] ?? 'both'}
                  label={t('conflict.title')}
                  onChange={(next) => setChoices((prev) => ({ ...prev, [c.Path]: next }))}
                  options={[
                    { value: 'both', label: t('conflict.keepBoth') },
                    { value: 'left', label: t('conflict.keepLeft') },
                    { value: 'right', label: t('conflict.keepRight') },
                  ]}
                />
              </div>
            </div>
          ))}
          <div className="flex justify-end">
            <Button
              label={t('history.applyChoices')}
              labelKey="history.applyChoices"
              glyph={<IconSave />}
              tone="accent"
              busy={busy}
              disabled={busy || picked.length === 0}
              onClick={() => {
                setBusy(true)
                const only = picked.map(([path]) => path)
                const resolve = Object.fromEntries(picked)
                void api
                  .run(job, only, resolve)
                  .then(() => onResolved())
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setBusy(false))
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
