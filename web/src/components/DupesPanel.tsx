import { useState } from 'react'

import { Badge } from '../lib/glimstone/Badge'
import { Button } from '../lib/glimstone/Button'
import { api, type Duplicates } from '../lib/api'
import { bytes } from '../lib/bytes'
import { translateSide, useT } from '../lib/i18n'

/**
 * The same content, found in more than one place on one side.
 *
 * Per SIDE and not per job, and that is the point rather than a shortcut: a
 * job's two sides are SUPPOSED to hold the same files, so a search across both
 * would report the sync doing its work. What somebody actually wants to know is
 * whether their own folder holds the holiday photos three times.
 *
 * It reports and it does not delete. Deciding which of three identical files is
 * the one to keep is a decision about what somebody's folders MEAN - the copy
 * in `urlaub/` and the copy in `backup/` are the same bytes and not the same
 * thing - and a button that picked for them would sooner or later pick wrong on
 * a file with no second copy anywhere.
 *
 * Behind a press rather than run on open. It walks the whole tree and hashes
 * every file that shares a size with another, which on a large job over a
 * network is minutes: something that expensive has to be asked for.
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
      {/* One button per side rather than a side switch and a search button.
          Two presses to ask one question is one press too many, and the pair
          says what the search is about at the same time. */}
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
          {/* Said out loud rather than swallowed. It is the one thing that
              makes the answer incomplete, and a target that cannot hash is
              common enough that silence here would read as "nothing more to
              find" on a search that never looked. */}
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
