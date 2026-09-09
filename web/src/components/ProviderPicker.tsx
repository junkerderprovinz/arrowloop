import { brandMark } from './brandMarks'
import { useT } from '../lib/i18n'
import type { Backend, Provider } from '../lib/api'

/**
 * Pick what you are connecting to, by NAME rather than by protocol.
 *
 * The form this replaces opened on a backend dropdown, which asked somebody to
 * know that Nextcloud is "webdav" before they could set up their Nextcloud.
 *
 * One column, one row each, no search box. jdp: "es soll eine schöne liste sein
 * wo alle einträge untereinander stehen ohne suchfeld." A grid was the first
 * answer and it was the wrong one: a grid is for browsing a set you have no
 * order for, and this list HAS an order - the ones people reach for, first.
 * Reading down one column follows that order; reading across four columns
 * fights it. And a search box over a list you can read is furniture.
 *
 * The logos are the brands' own, in the brands' own colours. A mark drawn in
 * the interface's ink is not the logo, it is a silhouette of it. Where a brand
 * has no mark in the CC0 set - Microsoft's, Amazon's and Apple's own products,
 * and OpenCloud, which must not wear ownCloud's - the row simply has no logo,
 * because a mark naming the WRONG service is worse than none.
 */
export function ProviderPicker({
  providers,
  unlisted,
  onPick,
}: {
  providers: Provider[]
  /** Compiled-in backends no provider entry covers, offered after the list. */
  unlisted: Backend[]
  onPick: (backend: string, preset: Record<string, string>) => void
}) {
  const { t } = useT()

  return (
    <div className="flex flex-col gap-3 py-2">
      <ul className="flex flex-col">
        {providers.map((p, i) => (
          <li key={p.id}>
            {i > 0 && <Rule />}
            <button
              type="button"
              onClick={() => onPick(p.backend, p.preset ?? {})}
              className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2 py-2.5 text-start transition-colors hover:bg-carbon-hover focus-visible:bg-carbon-hover focus-visible:outline-none"
            >
              {/* A fixed box whether or not there is a logo, so the names line
                  up down the column instead of stepping in and out. */}
              <span className="flex h-6 w-6 shrink-0 items-center justify-center text-[22px]">
                {brandMark(p.mark)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-dense text-carbon-text">{p.name}</span>
                {p.hint && (
                  <span className="block truncate text-caption text-carbon-textMuted">{p.hint}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* Everything rclone carries that nobody has written an entry for, folded
          away. It keeps the hand-kept list above from being a wall - a backend
          nobody has named is still reachable - without fifty rclone type names
          competing with the products for the eye. */}
      {unlisted.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer px-2 py-1 text-carbon-textMuted">
            {t('targets.pickMore', { count: unlisted.length })}
          </summary>
          <ul className="mt-1 flex flex-col">
            {unlisted.map((b, i) => (
              <li key={b.name}>
                {i > 0 && <Rule />}
                <button
                  type="button"
                  onClick={() => onPick(b.name, {})}
                  title={b.description}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2 py-2 text-start transition-colors hover:bg-carbon-hover focus-visible:bg-carbon-hover focus-visible:outline-none"
                >
                  <span className="h-6 w-6 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-dense text-carbon-text">{b.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/** The hairline between rows, the same one every list in this app uses. */
function Rule() {
  return <div className="h-px bg-carbon-border" />
}
