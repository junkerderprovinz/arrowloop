import { useState } from 'react'

import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { api, type Duplicates } from '../lib/api'
import { bytes } from '../lib/bytes'
import { translateSide, useT } from '../lib/i18n'

/**
 * Lists content found in more than one place on one side of a job.
 *
 * Per side, because the two sides are meant to hold the same files. It reports
 * and never deletes, since which copy to keep depends on what the folders mean.
 * The search hashes much of the tree, so it runs only when asked.
 */
export function DupesPanel({ job }: { job: string }) {
  const { t } = useT()
  const [side, setSide] = useState<'left' | 'right'>('left')
  const [found, setFound] = useState<Duplicates | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function look(which: 'left' | 'right') {
    setSide(which)
    setBusy(true)
    setError(null)
    setFound(null)
    try {
      setFound(await api.duplicates(job, which))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end gap-2">
        {(['left', 'right'] as const).map((which) => (
          <Button
            key={which}
            label={t('dupes.findOn', { side: translateSide(t, which) })}
            labelKey="dupes.findOn"
            busy={busy && side === which}
            disabled={busy}
            onClick={() => void look(which)}
          />
        ))}
      </div>

      {error && <p className="text-xs text-statusFail">{error}</p>}

      {found && found.groups.length === 0 && (
        <p className="text-xs text-statusOk">{t('dupes.none', { scanned: found.scanned })}</p>
      )}

      {found && found.groups.length > 0 && (
        <>
          <p className="text-xs text-carbon-textMuted">
            {t('dupes.summary', {
              sets: found.groups.length,
              wasted: bytes(found.wasted),
              scanned: found.scanned,
            })}
          </p>
          {/* Without this, a target that cannot hash would read as nothing
              more to find. */}
          {found.unhashable > 0 && (
            <p className="text-xs text-statusWarn">
              {t('dupes.unhashable', { count: found.unhashable })}
            </p>
          )}
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {found.groups.map((g) => (
              <li key={g.hash} className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2 text-xs">
                  <Badge tone="warn">{g.paths.length}&times;</Badge>
                  <span className="tabular-nums text-carbon-textMuted">
                    {t('dupes.each', { size: bytes(g.size), wasted: bytes(g.wasted) })}
                  </span>
                </div>
                <ul className="flex flex-col gap-0.5 ps-6">
                  {g.paths.map((p) => (
                    <li
                      key={p}
                      className="break-all font-mono text-xs text-carbon-text"
                      title={p}
                    >
                      {p}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
