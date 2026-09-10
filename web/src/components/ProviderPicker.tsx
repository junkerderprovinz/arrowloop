import { useMemo, useState } from 'react'

import { brandMark } from './brandMarks'
import { IconAction } from './IconAction'
import { IconCheck } from './glyphs'
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
  const showName = mode !== 'glyph'

  /**
   * Type to narrow the list, the way KnightLoader's host picker does.
   *
   * Fifty-one entries is past the point where scanning beats typing, and the
   * order is alphabetical rather than "what you probably want", so the name you
   * are after is as likely to be at the bottom as the top.
   *
   * It matches the HINT as well as the name, which is what makes the protocol
   * entries findable: somebody looking for their NAS types "nas" and the entry
   * is called "SMB / Windows share", whose hint says exactly that.
   */
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return providers
    return providers.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.hint?.toLowerCase().includes(needle) ||
        p.backend.toLowerCase().includes(needle),
    )
  }, [providers, query])

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
      {/* The search box, built the way KnightLoader's is: a filled surface2
          strip with the magnifier inside it rather than a bordered input beside
          a button. The glyph is this app's own IconCheck, which IS a magnifying
          glass - it means "open a target and look at it" elsewhere, and a
          magnifier at the head of a text field is read as search by everybody
          before any of that matters. */}
      <div className="mx-auto flex w-full max-w-sm items-center gap-2 rounded-[var(--radius-control)] bg-carbon-surface2 px-3 py-2">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-carbon-textMuted">
          <IconCheck />
        </span>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('targets.pickSearch')}
          aria-label={t('targets.pickSearch')}
          className="min-w-0 flex-1 bg-transparent text-body text-carbon-text outline-none placeholder:text-carbon-textMuted"
        />
      </div>

      {shown.length === 0 && (
        <p className="px-2 py-3 text-center text-body text-carbon-textMuted">
          {t('targets.pickNoMatch', { q: query.trim() })}
        </p>
      )}

      <ul className="mx-auto flex max-h-72 w-full max-w-sm flex-col gap-1 overflow-y-auto">
        {shown.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p)}
              title={p.hint || undefined}
              className={ROW}
            >
              {/* A fixed box whether or not there is a mark, so every name in
                  the column starts at the same x.

                  WIDER than it is tall, and that is not a whim: five of these
                  logos are wordmarks rather than symbols, and a 5.3:1 drawing
                  fitted into a square box is 8 pixels tall. Measured across all
                  44 marks - Linkbox 5.3:1, Gofile 3.5, Quatrix 3.1, Huawei 2.8,
                  OpenDrive 2.3. At 64 by 40 the widest of them gains half its
                  height again, while every square mark still renders at 40 and
                  simply sits centred in a roomier box.

                  This box is the ONE thing not copied from KnightLoader, whose
                  host icons are 18px squares. These are not icons: they are
                  brand marks, several of them words, and 18px would put the
                  wordmarks back at the size that made them unreadable. */}
              {showMark && (
                <span className="flex h-10 w-16 shrink-0 items-center justify-center [&_svg]:h-full [&_svg]:w-full">
                  {brandMark(p.mark)}
                </span>
              )}
              {/* The name, and under it the one line of explanation the
                  protocols get. It used to sit at the END of the row, which
                  worked while the row was the width of the card and broke the
                  moment the list became narrow: the hint could not shrink, so
                  the NAME gave up the space instead and "S3 compatible" was
                  rendered as "S.". A name that cannot be read is not a list
                  entry. Under it, both survive. */}
              {showName && (
                <span className="flex min-w-0 flex-1 flex-col text-start">
                  <span className="truncate text-body text-carbon-text">{p.name}</span>
                  {showHint(p) && (
                    <span className="truncate text-caption text-carbon-textMuted">{p.hint}</span>
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
 * One row of the list, copied from KnightLoader's host picker. jdp: "wir machen
 * die Kacheln wie in KL."
 *
 * NO FILL at rest, and that is the whole of it. The rows here were filled tiles
 * on `--carbon-surface2`, and the hover was reported as weaker than KL's - so
 * both were read out of the token files rather than argued about:
 *
 *   filled tile:   #393939 -> #525252   (25 units)
 *   KnightLoader:  no fill -> #353535   (15 units)
 *
 * The bigger jump was already here, and it still read as less. What differs is
 * not the size of the step but what the step DOES: an unfilled row hovered
 * CREATES a shape on a page that had none, while a filled tile hovered only
 * shifts one of fifty boxes a shade. That is why the smaller number wins, and
 * why chasing it with a brighter tone on a filled tile would have missed the
 * point entirely.
 *
 * So: transparent, `--carbon-hover` under the pointer, the control radius
 * rather than the card one, and KL's tighter padding. Rule 21 names
 * `--carbon-hover` as the hover for an element with no fill of its own, which
 * is exactly what this now is - the same token that was wrong here while these
 * were tiles is right now that they are not.
 *
 * No `focus-visible:outline-none` here either, which is what it used to carry,
 * with `brightness-125` in its place. That removed the keyboard focus ring from
 * every row in the list and replaced it with something that reads as roughly
 * the same as hover - so a person tabbing through fifty providers could not see
 * where they were. The language's own `:focus-visible` rule draws a real 2px
 * ring; this row lets it.
 */
const ROW =
  'flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-start ' +
  'transition-colors hover:bg-carbon-hover'
