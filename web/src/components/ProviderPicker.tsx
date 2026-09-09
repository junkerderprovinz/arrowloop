import { brandMark } from './brandMarks'
import { IconAction } from './IconAction'
import { useT } from '../lib/i18n'
import type { Backend, Provider } from '../lib/api'

/**
 * Pick what you are connecting to, by NAME rather than by protocol.
 *
 * A scrolling column of wide rows: the mark on the left, the name beside it,
 * one entry per line. jdp: "Die Kacheln sollen rechteckig sein und logo und
 * Name nebeneinander, die logos sollen größer sein. die kacheln sollen
 * untereinander angeordnet sein, eine scrolbare liste."
 *
 * This replaces a grid of square tiles, and the reason it is better is the
 * mark. A square tile has to stack the logo above the name, so the logo can
 * only be as wide as the name is - and the name is what forced the tile's
 * width. A row spends its width on the name and its height on nothing else, so
 * the mark gets the whole line height and lands at 40px instead of 36 while the
 * row takes LESS vertical space than the tile did. Same list, bigger logos,
 * shorter page.
 *
 * No sub-text on the cloud rows. The name and the mark say it, and a line of
 * explanation under a brand somebody already knows is noise on every row in
 * order to help on none. The protocol rows keep theirs, now at the END of the
 * line rather than under the name, because "SMB" and "WebDAV" genuinely do not
 * say what they are to everybody who arrives here.
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
  // theirs. Decided per row rather than per list, so one list can hold both.
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

      {/* Scrolls rather than growing: fifty providers push a card taller than
          the window, and then the card's own controls are somewhere off the
          bottom of the page. A fixed height means the list moves and the page
          around it does not. */}
      <ul className="flex max-h-[26rem] flex-col gap-1 overflow-y-auto">
        {providers.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p.backend, p.preset ?? {})}
              title={p.hint || undefined}
              className={ROW}
            >
              {/* A fixed box whether or not there is a mark, so every name in
                  the column starts at the same x. */}
              <span className="flex h-10 w-10 shrink-0 items-center justify-center text-[40px]">
                {brandMark(p.mark)}
              </span>
              <span className="min-w-0 flex-1 truncate text-body text-carbon-text">{p.name}</span>
              {showHint(p) && (
                <span className="shrink-0 ps-3 text-caption text-carbon-textMuted">{p.hint}</span>
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
                  className="w-full truncate rounded-[var(--radius-control)] bg-carbon-surface2 px-3 py-2 text-center text-dense text-carbon-text transition hover:bg-carbon-surface3"
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

/**
 * One row of the list.
 *
 * `hover:bg-carbon-surface3` and NOT `hover:bg-carbon-hover`, which is what
 * this said before and why jdp asked for "kacheln bei mouseover hell machen wie
 * in KL". `--carbon-hover` is the hover fill for something that has NO fill of
 * its own - a transparent row on a card - and it sits BELOW `--carbon-surface2`
 * on the dark ramp (#353535 against #393939). So a row that already carries
 * surface2 got four units DARKER under the pointer: the one place a person is
 * looking straight at it, and it dimmed. `--carbon-surface3` is the next tone
 * UP (#525252), which is the step KnightLoader's secondary button already
 * takes.
 *
 * No `focus-visible:outline-none` here either, which is what it used to carry,
 * with `brightness-125` in its place. That removed the keyboard focus ring from
 * every row in the list and replaced it with something that now reads as
 * roughly the same as hover - so a person tabbing through fifty providers could
 * not see where they were. The language's own `:focus-visible` rule draws a
 * real 2px ring; this row lets it.
 */
const ROW =
  'flex w-full items-center gap-3 rounded-card bg-carbon-surface2 px-4 py-2 text-start ' +
  'transition-colors hover:bg-carbon-surface3'
