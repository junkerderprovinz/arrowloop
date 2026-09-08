import { useEffect, useState } from 'react'

import { Badge } from '../lib/glimstone/Badge'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { api, type Resolution, type RunEntry } from '../lib/api'
import { useT, type TranslationKey } from '../lib/i18n'
import { Choice } from './Field'
import { Button } from '../lib/glimstone/Button'
import { IconCopy, IconSave } from './glyphs'
import { download } from '../lib/download'

/**
 * What one run actually did, path by path.
 *
 * The row above this says "12 copied, 2 conflicts, 1 error", and jdp asked the
 * question those numbers cannot answer: which file, and what was decided.
 *
 * The conflicts are the important half. A run started by the schedule resolves
 * every conflict by keeping both versions, because that is the only outcome a
 * machine can reach on its own without choosing for somebody. That decision was
 * made while nobody was watching, and until now nothing ever mentioned it. So
 * this panel does two things: it says what happened, and for a conflict it lets
 * the decision be revisited, which is the only thing on the page that is not
 * merely a report.
 *
 * Fetched when a run is OPENED rather than with the list. Fifty runs' worth of
 * paths to draw fifty rows saying "12 copied" would be thousands of strings
 * nobody reads.
 */

/** The kinds, in the order somebody wants to see them. */
const KIND_LABEL: Record<string, TranslationKey> = {
  copy: 'entry.copy',
  move: 'entry.move',
  trash: 'entry.trash',
  conflict: 'entry.conflict',
  mkdir: 'entry.mkdir',
  rmdir: 'entry.rmdir',
  skip: 'entry.skip',
}

/** The two separators the exported log is built from.
 *
 *  Named rather than written inline because an escape sequence in a string is
 *  exactly the thing that gets mangled on its way through an editor or a patch,
 *  and a tab that has quietly become a space produces a file that still looks
 *  right and no longer opens as columns. Written as codepoints rather than as
 *  escapes for the same reason, one turn after this comment was itself written
 *  by a tool that ate both backslashes and left an unterminated string.
 */
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
  /** Called after a conflict has been sent back for a second opinion. */
  onResolved: () => void
}) {
  const { t } = useT()
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
    // Cancelled on unmount, because a panel closed while its request is in
    // flight would otherwise set state on something nobody is looking at.
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
    <div className="flex flex-col gap-2 pb-3">
      {/* A copy of this list as a plain file. The reason it is here rather
          than nowhere: the most useful thing somebody can do with a run that
          went wrong is send it to somebody else, and selecting eight hundred
          rows out of a scrolling box is not that. Plain text, tab separated, so
          it opens in anything. */}
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
            <Badge tone={tone(e.Kind)}>{t(KIND_LABEL[e.Kind] ?? 'entry.other')}</Badge>
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
          {/* The only part of this panel that is not a report. A run that kept
              both versions did so because nobody was there to choose, and this
              is where that gets a second look. Choosing here does not rewrite
              history: it starts a fresh run for exactly these paths with the
              chosen resolutions, so the record of what the first run did stays
              exactly as it was. */}
          {/* The explanation is a bubble on the heading rather than a grey
              paragraph above the rows (jdp: "Info texte sollen immer in i
              infobubbles!"), which is rule 8: prose printed under a control is
              read once and costs vertical space for ever. The heading it hangs
              off is the one the rows already answer. */}
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
              // Nothing picked means nothing to do. A button that runs a job
              // when every row still says "keep both" would start a whole run
              // to change nothing.
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
