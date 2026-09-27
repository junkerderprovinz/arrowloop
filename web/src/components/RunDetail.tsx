import { useEffect, useState } from 'react'

import { Badge } from '../lib/glimstone/Badge'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { api, type RunEntry } from '../lib/api'
import { entryLabel, entryNote } from '../lib/entryLabel'
import { useGoTo } from '../lib/goTo'
import { usePlaces } from '../lib/places'
import { useT } from '../lib/i18n'
import { Button } from '../lib/glimstone/Button'
import { IconConflict, IconCopy } from './glyphs'
import { download } from '../lib/download'

/**
 * What one run did, path by path, fetched when the run is opened.
 *
 * A scheduled run resolves every conflict by keeping both versions, since it
 * cannot choose for anybody; the run points to the conflicts tab, where that
 * choice is made.
 */

/** The note a run writes on a conflict it kept both versions of; see plan.Resolution. */
const KEPT_BOTH = 'keep both'

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
  tick = 0,
}: {
  run: number
  job: string
  /** Changes while the run is still going, to read its lines again. */
  tick?: number
}) {
  const { t } = useT()
  const goTo = useGoTo()
  const { jobs, drives } = usePlaces()
  const config = jobs.find((j) => j.name === job)
  const [entries, setEntries] = useState<RunEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Emptied only for another run: a running run's lines are read again every
  // second and stay on screen meanwhile.
  useEffect(() => {
    setEntries(null)
    setError(null)
  }, [run])

  useEffect(() => {
    let live = true
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
  }, [run, tick])

  if (error) return <p className="py-2 text-xs text-statusFail">{error}</p>
  if (entries === null) return <p className="py-2 text-xs text-carbon-textMuted">{t('history.loading')}</p>
  if (entries.length === 0) return <p className="py-2 text-xs text-carbon-textMuted">{t('history.nothing')}</p>

  const keptBoth = entries.filter((e) => e.Kind === 'conflict' && e.Note === KEPT_BOTH).length

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
        {entries.map((e, i) => {
          const note = entryNote(t, e)
          return (
            <li key={`${e.Path}-${i}`} className="flex items-start gap-2 text-xs">
              <Badge tone={tone(e.Kind)}>{entryLabel(t, e, config, drives)}</Badge>
              <span className="min-w-0 flex-1 break-all font-mono text-carbon-text" title={e.Path}>
                {e.Path}
              </span>
              {note && (
                <span className="min-w-0 max-w-[45%] shrink-0 text-carbon-textMuted" title={note}>
                  {note}
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {/* Deciding happens in the conflicts tab, which knows which of these are
          still open; this run's record stays as it was. */}
      {keptBoth > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="flex items-center gap-1.5 text-xs text-carbon-textMuted">
            {t('history.keptBoth', { count: keptBoth })}
            <InfoBubble tip={t('history.keptBothHint')} />
          </span>
          <Button
            label={t('history.toConflicts')}
            labelKey="history.toConflicts"
            glyph={<IconConflict />}
            onClick={() => goTo({ tab: 'conflicts', job })}
          />
        </div>
      )}
    </div>
  )
}
