import { brandMark } from './brandMarks'
import { IconAction } from './IconAction'
import { useT } from '../lib/i18n'
import type { Backend, Provider } from '../lib/api'

/**
 * Pick what you are connecting to, by NAME rather than by protocol.
 *
 * Tiles rather than rows, and large ones. jdp: "die einträge sollen deutlich
 * größer und zentriert als kacheln erscheinen." A row is a thing you read; a
 * tile is a thing you aim at, and this list is aimed at rather than read - the
 * logo is doing the work, and a logo needs room to be recognised rather than
 * merely present.
 *
 * No sub-text on the cloud tiles. The name and the mark say it, and a line of
 * explanation under a brand somebody already knows is noise on every tile in
 * order to help on none. The protocol tiles keep theirs, because "SMB" and
 * "WebDAV" genuinely do not say what they are to everybody who arrives here.
 *
 * ALPHABETICAL, decided in the Go table. A list ordered by "what people reach
 * for first" only helps somebody who already agrees with the ordering; anybody
 * looking for a particular name reads the whole thing to find out it is not
 * near the top.
 */
export function ProviderPicker({
  providers,
  unlisted,
  onPick,
  onCancel,
}: {
  providers: Provider[]
  /** Compiled-in backends no provider entry covers, offered after the list. */
  unlisted: Backend[]
  onPick: (backend: string, preset: Record<string, string>) => void
  /**
   * Leaving without picking anything.
   *
   * It had no way out at all: opening the list committed you to choosing
   * something or reloading the page. jdp: "Aus den listen kann man nicht
   * zurückgehen." A picker is a question, and a question you cannot decline is
   * a trap.
   */
  onCancel: () => void
}) {
  const { t } = useT()
  // The clouds are the ones with no hint worth showing; the protocols carry
  // theirs. Decided per tile rather than per list, so one list can hold both.
  const showHint = (p: Provider) => p.group === 'protocol' && Boolean(p.hint)

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex justify-start">
        <IconAction
          title={t('preview.back')}
          labelKey="preview.back"
          hueIndex={1}
          onClick={onCancel}
        />
      </div>

      {/* Tiles wide enough for the longest product name on one line, so the
          grid loses columns on a narrow window rather than breaking names. */}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
        {providers.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p.backend, p.preset ?? {})}
              title={p.hint || undefined}
              className="flex h-28 w-full flex-col items-center justify-center gap-2 rounded-card bg-carbon-surface2 px-3 text-center transition hover:bg-carbon-hover focus-visible:brightness-125 focus-visible:outline-none"
            >
              {/* Large, because recognising a logo is the whole point of
                  putting one there. A fixed box whether or not there is a
                  mark, so the names sit on one line across the row. */}
              <span className="flex h-9 w-9 items-center justify-center text-[36px]">
                {brandMark(p.mark)}
              </span>
              <span className="w-full truncate text-dense text-carbon-text">{p.name}</span>
              {showHint(p) && (
                <span className="w-full truncate text-caption text-carbon-textMuted">{p.hint}</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {/* Everything rclone carries that nobody has written an entry for, folded
          away. It keeps the hand-kept table from being a wall - a backend
          nobody has named is still reachable - without fifty rclone type names
          competing with the products for the eye. */}
      {unlisted.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer px-1 py-1 text-carbon-textMuted">
            {t('targets.pickMore', { count: unlisted.length })}
          </summary>
          <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
            {unlisted.map((b) => (
              <li key={b.name}>
                <button
                  type="button"
                  onClick={() => onPick(b.name, {})}
                  title={b.description}
                  className="w-full truncate rounded-[var(--radius-control)] bg-carbon-surface2 px-3 py-2 text-center text-dense text-carbon-text transition hover:bg-carbon-hover focus-visible:brightness-125 focus-visible:outline-none"
                >
                  {b.name}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
