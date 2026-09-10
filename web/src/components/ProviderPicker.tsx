import { brandMark } from './brandMarks'
import { IconAction } from './IconAction'
import { useLabelMode } from '../lib/glimstone/useLabelMode'
import { useT } from '../lib/i18n'
import type { Backend, Provider } from '../lib/api'

/**
 * Pick what you are connecting to, by NAME rather than by protocol.
 *
 * A search box over a scrolling column of unfilled rows: the mark on the left,
 * the name beside it, one entry per line. Built the way KnightLoader's host
 * picker is, on jdp's instruction ("wir machen die Kacheln wie in KL"), which
 * settles three things at once - the rows carry no fill, the hover therefore
 * CREATES a shape rather than shifting one, and typing beats scrolling once a
 * list runs past about twenty entries.
 *
 * It replaces a grid of square tiles, and the reason a row is better is the
 * mark. A square tile has to stack the logo above the name, so the logo can
 * only be as wide as the name is - and the name is what forced the tile's
 * width. A row spends its width on the name and its height on nothing else, so
 * the mark gets the whole line height at 64 by 40. Same list, bigger logos,
 * shorter page.
 *
 * ONE thing is deliberately not copied from KL: its host icons are 18px
 * squares, and these are not icons. Several of these marks are words rather
 * than symbols, and at 18px a 5.3:1 wordmark is three pixels tall.
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
  /**
   * What was picked, as the whole provider rather than as a backend name.
   *
   * It used to hand over the backend and the preset, which is everything the
   * SAVE needs and nothing the form needs to be helpful: the product's name is
   * what a target should be called, and its address shape is what the url field
   * has to explain. An unlisted backend has no provider entry, so it arrives as
   * a bare backend name and the form falls back to what it had before.
   */
  onPick: (picked: Provider | string) => void
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

  /**
   * These rows answer the app-wide label setting like every other control.
   *
   * jdp: "auch in die beschriftungsengine aufnehmen." They were plain buttons
   * outside the engine, so with the setting on glyph-only every control on the
   * page went quiet and fifty product names stayed - which is the same defect
   * the row actions had, in a different place, and from outside it looks like
   * the setting not working rather than like a list that opted out.
   *
   * `reactive` deliberately resolves to the same thing as `textGlyph` HERE and
   * nowhere else. Reactive means the words appear under the pointer, which is
   * right for a strip of five verbs somebody already knows and wrong for fifty
   * brands somebody is SEARCHING: it would turn "find Backblaze" into hovering
   * every tile in turn. A picker is the one surface where hiding the labels
   * until asked defeats the surface.
   */
  const mode = useLabelMode('buttons')
  const showMark = mode !== 'text'
  /**
   * A row with NO mark keeps its name even in the mode that hides names.
   *
   * The same rule the button component has, and it earns its place the same
   * way: three of the S3 entries have no logo in the set at all - IDrive,
   * Linode, SeaweedFS - and a row that hides its name and has nothing to draw
   * is an empty box you have to click to identify. Until those three arrived
   * every provider had a mark, so glyph mode happened to be safe; that was
   * luck rather than design, and this is the design.
   */
  const showName = (p: Provider) => mode !== 'glyph' || !brandMark(p.mark)


  return (
    <div className="flex flex-col gap-4 py-2">
      {/* Hard right, where every other control that leaves a card sits. jdp:
          "der zurückbutton in den cards bitte auch nach ganz rechts." The
          save/cancel pair on the form this list leads to is already there, so
          a back button on the left made the way out move across the card
          between one step and the next. */}
      <div className="flex justify-end">
        <IconAction
          title={t('preview.back')}
          labelKey="preview.back"
          hueIndex={1}
          onClick={onCancel}
        />
      </div>

      {/* Narrow and centred. jdp: "die kacheln sollen nicht so breit sien, die
          sollen nur mittig sein." A row only needs room for a 64px mark box and
          a product name, and stretching it across a full-width card puts the
          name and the mark at opposite ends of a long empty stretch - which is
          the one thing a list of short labels must not do.

          Scrolls rather than growing: fifty providers push a card taller than
          the window, and then the card's own controls are somewhere off the
          bottom of the page. A fixed height means the list moves and the page
          around it does not. */}
      {/* Two across, always, and the tile is KnightLoader's extension tile:
          the mark above the name, both centred, the tile itself the button.
          jdp: "mach kacheln wie bei den erwieterungen von KL. immer zwei
          nebeneinander, keine suchfunktoin."

          `grid-cols-2` rather than KL's `flex-wrap`, and that is the one
          difference asked for: KL's tiles are a fixed 112px square and wrap at
          whatever the width allows, so the count per row moves with the window.
          Two is a decision, so it is written as two.

          The mark box is WIDE inside a tile that is not square, and that is the
          other difference. Several of these are wordmarks rather than symbols -
          Linkbox 5.3:1, Gofile 3.5, Quatrix 3.1 - and a 5.3:1 drawing fitted
          into KL's 56px square is ten pixels tall. Two-across leaves each tile
          wider than it is tall anyway, so the mark gets that width. */}
      <ul className="mx-auto grid w-full max-w-sm grid-cols-2 gap-3">
        {providers.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p)}
              title={p.hint || undefined}
              className={TILE}
            >
              {/* The mark FILLS this box rather than being capped by it.
                  `max-h-full max-w-full` was the whole sizing rule and it does
                  nothing: every mark carries `width="1em" height="1em"`, so it
                  arrived as a 16px square inside a box of 48 by 96 and a cap
                  never fires on something already smaller. Measured on this
                  build, Synology's wordmark drew four pixels tall.

                  `h-full w-full` does not stretch anything - an svg with a
                  viewBox letterboxes inside its element - so each mark takes
                  as much of the box as its own proportions allow. Which is
                  what makes the cropping in the generator worth anything: the
                  box a mark declares is now the box it is scaled by, so a
                  wordmark cropped to its ink gets the full 96px of width
                  instead of fitting a mostly empty square into 16. */}
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
                  {showHint(p) && (
                    <span className="mt-0.5 block break-words text-caption leading-tight text-carbon-textMuted">
                      {p.hint}
                    </span>
                  )}
                </span>
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
 * One tile, copied from KnightLoader's extension tiles. jdp: "mach kacheln wie
 * bei den erwieterungen von KL."
 *
 * The mark above the name, both centred, and the tile itself is the button.
 *
 * The hover is the part worth reading twice: `surface3` on light and WHITE on
 * dark. That is KL's own, and it answers a report from earlier today that its
 * hover felt stronger than this app's. It does, and not because of a bigger
 * step on the same ramp - it steps OFF the ramp entirely at the top end. Going
 * to white is a thing the surface tokens cannot express, which is why measuring
 * the two ramps against each other never explained the difference.
 *
 * It does NOT go white in the light theme, and that is not a second opinion
 * about the request: these tiles sit on a card that is already white there, so
 * a literal white hover makes the tile vanish into the card instead of lifting
 * off it. The same reasoning KL's own comment records, reached the same way.
 *
 * `brand-hover-light` is what pays for that white. A tile that goes white is
 * showing a LIGHT ground, so every mark on it has to wear its light value for
 * as long as the pointer is there - and eleven of them did not. Measured on
 * this build before the class existed: put.io, OpenCloud, Cloudinary, the
 * Internet Archive, Filen, Linkbox, Uloz.to and OpenDrive all reached exactly
 * 1.00 against the tile under the pointer, which is white on white. The
 * caption already flips with `dark:hover:text-[#161616]`; this is the same
 * flip for the logo above it, and the rule that does it is generated beside
 * the colours themselves in brandGlyphs.css.
 *
 * No `focus-visible:outline-none`. A keyboard ring is the only thing telling
 * somebody tabbing through sixty tiles where they are, and a hover that reads
 * the same as focus takes that away.
 */
const TILE =
  'brand-hover-light flex h-full w-full flex-col items-center justify-center gap-2 ' +
  'rounded-[var(--radius-control)] bg-carbon-surface2 px-2 py-3 text-carbon-text ' +
  'transition-colors duration-150 ' +
  'hover:bg-carbon-surface3 dark:hover:bg-white dark:hover:text-[#161616]'
