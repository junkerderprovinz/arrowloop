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
