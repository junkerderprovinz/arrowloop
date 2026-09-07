import type { CSSProperties } from 'react'

import { hueVars, rainbowAt } from '../lib/appearance'
import { IconBothWays, IconToLeft, IconToRight } from './glyphs'
import { useT, type TranslationKey } from '../lib/i18n'
import type { Direction } from '../lib/api'

/**
 * Which way a job is allowed to write, drawn rather than described.
 *
 * The arrows carry it because that is the one thing about a job somebody wants
 * to read at a glance from a list, and three words in three languages take
 * three different amounts of room while three arrows take the same.
 *
 * The word is still there as the hover bubble and as the accessible name, so
 * nothing is lost: a glyph nobody can name is a decoration.
 */
export const DIRECTIONS: Direction[] = ['both', 'leftToRight', 'rightToLeft']

export const directionKey: Record<Direction, TranslationKey> = {
  both: 'direction.both',
  leftToRight: 'direction.toRight',
  rightToLeft: 'direction.toLeft',
}

export function DirectionGlyph({ direction }: { direction: Direction }) {
  if (direction === 'leftToRight') return <IconToRight />
  if (direction === 'rightToLeft') return <IconToLeft />
  return <IconBothWays />
}

/** The direction of a job as it appears between the two sides in a list. */
export function DirectionMark({ direction }: { direction: Direction }) {
  const { t } = useT()
  const name = t(directionKey[direction])
  return (
    <span
      className="inline-flex shrink-0 items-center text-carbon-textMuted"
      title={name}
      data-tip={name}
      aria-label={name}
      role="img"
    >
      <DirectionGlyph direction={direction} />
    </span>
  )
}

/** The next direction in the cycle, wrapping back to both ways. */
export function nextDirection(current: Direction): Direction {
  const at = DIRECTIONS.indexOf(current)
  return DIRECTIONS[(at + 1) % DIRECTIONS.length]
}

/**
 * The direction, editable, sitting BETWEEN the two sides it describes.
 *
 * A three-segment picker in a field of its own says the same thing, and says it
 * in the wrong place: the direction is a fact about the relationship between
 * the left box and the right box, so anywhere other than between them the
 * reader has to hold two things in their head and join them up. Put it in the
 * gap and the row reads as one sentence, left to right.
 *
 * Clicking cycles rather than opening a menu. There are exactly three answers
 * and each is one glyph, so a menu would be two interactions and a floating
 * layer to choose between three things already on screen. The arrow keys do the
 * same thing for anybody not using a pointer, and the accessible name says
 * which of the three is current, because a cycling button whose name never
 * changes is a button that lies to a screen reader.
 */
export function DirectionSwitch({
  direction,
  onChange,
  hint,
}: {
  direction: Direction
  onChange: (next: Direction) => void
  /**
   * What the three answers mean, carried in the same bubble as the current one.
   *
   * It rides here rather than beside the control as its own (i) because there
   * is no label for an (i) to sit beside: this button IS the label, drawn. A
   * lone (i) above it hung an explanation off nothing.
   */
  hint?: string
}) {
  const { t } = useT()
  const name = t(directionKey[direction])
  // Two sentences rather than a joined phrase, so neither half is written to
  // fit beside the other in forty-two languages.
  const tip = hint ? `${name}. ${hint}` : name

  return (
    <button
      type="button"
      onClick={() => onChange(nextDirection(direction))}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault()
          onChange(nextDirection(direction))
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          // Two steps forward in a three-cycle is one step back, so the
          // backwards key needs no arithmetic of its own to keep in step with
          // the order the forwards one uses.
          onChange(nextDirection(nextDirection(direction)))
        }
      }}
      title={tip}
      data-tip={tip}
      aria-label={`${t('direction.label')}: ${name}`}
      className="glim-btn glim-hue inline-flex h-9 w-9 shrink-0 items-center justify-center bg-carbon-surface2 text-carbon-text transition-colors hover:bg-carbon-hover"
      style={{ borderRadius: 'var(--radius-control)', ...(hueVars(rainbowAt(0)) as CSSProperties) }}
    >
      {/* The glyph carries the class the label engine keys off, so a control
          that is only ever a glyph still answers to the same setting as every
          other button. Its words live in the tip: this is one control with
          three states, and printing the state name beside it would be a label
          that changes meaning every third press. */}
      <span className="glim-btn-glyph" aria-hidden>
        <DirectionGlyph direction={direction} />
      </span>
    </button>
  )
}
