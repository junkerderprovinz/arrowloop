import { brandMark } from './brandMarks'
import { IconAction } from './IconAction'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { useLabelMode } from '../lib/glimstone/useLabelMode'
import { useT } from '../lib/i18n'
import type { Backend, Provider } from '../lib/api'

/**
 * Picks what a target connects to by product name rather than by protocol, as
 * a two-column grid of tiles in the style of KnightLoader's extension tiles.
 * Only the protocol tiles carry a hint, in an info bubble, since a cloud's name
 * already says what it is. The order is alphabetical, set in the Go table.
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
  /**
   * The whole provider, so the form can name the target after the product and
   * explain its address shape. An unlisted backend arrives as its bare name.
   */
  onPick: (picked: Provider | string) => void
  onCancel: () => void
}) {
  const { t } = useT()
  const showHint = (p: Provider) => p.group === 'protocol' && Boolean(p.hint)

  // The tiles follow the label setting, except that reactive shows names like
  // text-and-glyph: hiding them until hovered would defeat a list somebody is
  // searching by name.
  const mode = useLabelMode('buttons')
  const showMark = mode !== 'text'
  // A provider with no logo keeps its name even in glyph mode, or its tile
  // would be an empty box.
  const showName = (p: Provider) => mode !== 'glyph' || !brandMark(p.mark)

  return (
    <div className="flex flex-col gap-4 py-2">
      {/* Right-aligned, where the form this list leads to keeps its own
          save and cancel. */}
      <div className="flex justify-end">
        <IconAction
          title={t('preview.back')}
          labelKey="preview.back"
          hueIndex={1}
          onClick={onCancel}
        />
      </div>

      {/* Narrow, centred and always two across. The mark box is wide because
          several marks are wordmarks (Linkbox is 5.3:1). The list scrolls at
          four tiles deep so the card's own controls stay on screen, and `pe-1`
          gives the scrollbar its own lane. */}
      <ul className="mx-auto grid max-h-96 w-full max-w-sm grid-cols-2 gap-3 overflow-y-auto pe-1">
        {providers.map((p) => (
          <li key={p.id} className="relative">
            <button
              type="button"
              onClick={() => onPick(p)}
              title={p.hint || undefined}
              className={TILE}
            >
              {/* Every mark carries width="1em", so a max-size cap never fires;
                  full size lets the viewBox letterbox the mark into the box. */}
              {showMark && (
                <span className="flex h-12 w-24 shrink-0 items-center justify-center [&_svg]:h-full [&_svg]:w-full">
                  {brandMark(p.mark)}
                </span>
              )}
              {showName(p) && (
                <span className="w-full px-1 text-center">
                  <span className="block break-words text-dense font-medium leading-tight">
                    {p.name}
                  </span>
                </span>
              )}
            </button>
            {/* A sibling of the button, so a click on the bubble does not also
                pick the provider. */}
            {p.hint && showHint(p) && (
              <span className="absolute end-1.5 top-1.5">
                <InfoBubble tip={p.hint} />
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* rclone backends with no provider entry, folded away but reachable. */}
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
                  onClick={() => onPick(b.name)}
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
 * One tile: the mark above the name, the tile itself the button.
 *
 * In the dark theme the hover goes to white, as KnightLoader's does; in the
 * light theme the card is already white, so it steps to surface3 instead. On
 * a white tile a dark-theme mark would vanish, so `brand-hover-light` switches
 * each mark to its light value (generated in brandGlyphs.css), as the caption
 * does with `dark:hover:text-[#161616]`. The keyboard focus ring is kept.
 */
const TILE =
  'brand-hover-light flex h-full w-full flex-col items-center justify-center gap-2 ' +
  'rounded-[var(--radius-control)] bg-carbon-surface2 px-2 py-3 text-carbon-text ' +
  'transition-colors duration-150 ' +
  'hover:bg-carbon-surface3 dark:hover:bg-white dark:hover:text-[#161616]'
