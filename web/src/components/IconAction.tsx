import type { ReactNode } from 'react'

import { Button } from '../lib/glimstone/Button'

/**
 * A small, single-purpose action drawn as a glyph.
 *
 * It was GlimStone's Badge with `as="button" shape="square" size="icon"`, and
 * that was the defect rather than the shorthand: a badge is outside the label
 * engine, so a row of these ignored the one app-wide setting that decides what a
 * button shows while every other control on the page answered it. jdp: "die
 * ganzen button sollen alle in die farb und beschriftungsengine!"
 *
 * GlimStone 1.7.6 answered that with a variant that stayed glyph-only in every
 * mode, on the reasoning that a wall of words is not what anybody asked for.
 * jdp rejected it in the same words as the original report, and the measurement
 * says why: with the setting on text-plus-glyph, five controls in this card's
 * row printed no word while three beside them did. From outside, a documented
 * exemption and a control that ignores the setting look identical.
 *
 * So in 1.7.7 the variant decides the SHAPE and the mode decides the words: an
 * ordinary labelled button where the setting paints text, a square at the button
 * height where it does not. If the row should be a tidy strip of tiles, that is
 * what the glyph mode is for, and it is one setting away.
 *
 * What the change buys beyond the setting: the colour engine, the tone table,
 * the busy spinner, one tooltip mechanism rather than two, and the wrapper that
 * keeps a DISABLED control's explanation reachable, which a bare badge could not
 * do because a disabled button emits no mouse events at all.
 *
 * `hint` is a second sentence rather than a joined phrase, so neither half has
 * to be written to fit beside the other in forty-two languages. It exists
 * because a row of icon-only buttons must never need a lone "(i)" standing among
 * them: an explanation belongs beside a control's LABEL, and these have none, so
 * the sentence rides in the bubble the pointer is already heading for.
 */
export function IconAction({
  children,
  onClick,
  title,
  labelKey,
  hint,
  disabled,
  busy,
  size = 'default',
  tone = 'accent',
  hueIndex,
}: {
  /**
   * The mark. Optional now, and usually left out: the label key resolves one by
   * MEANING, so the same verb wears the same symbol everywhere without every
   * call site choosing. Pass one only where this action's symbol is genuinely
   * its own.
   */
  children?: ReactNode
  onClick?: () => void
  /** The control's name, shown on hover and read by a screen reader. */
  title: string
  /**
   * The translation key behind `title`, or null when the name is DATA.
   *
   * Required rather than optional, exactly as it is on Button and for the same
   * reason: optional, it goes quietly missing, and a control with no key cannot
   * pick a glyph, so it falls back to text in the two modes that exist to hide
   * text. Nothing fails and nothing goes red; the button simply never joins the
   * engine, and the only way to find it is to look.
   */
  labelKey: string | null
  /** One sentence on what pressing it does, in the same bubble as the name. */
  hint?: string
  disabled?: boolean
  busy?: boolean
  /**
   * One step up, for the action a page exists to offer.
   *
   * GlimStone 1.7.5 gave the language a second button height and said there
   * will not be a third, so this is a two-value switch rather than a size
   * prop. Exactly one control in this app takes it: the button that creates a
   * job, on the page that lists jobs. jdp: "Der Button fuer auftrag anlegen
   * soll groesser sein. haben wir nicht eine groessere standardisierte
   * groesse?"
   */
  size?: 'default' | 'key'
  /**
   * The surface, and the DEFAULT is the accent because grey is not a colour the
   * engine can reach.
   *
   * It was "subtle", which resolves to a flat `bg-carbon-surface2` and therefore
   * paints exactly the same in every rainbow position, in reactive mode, and
   * with the engine off. That is what got reported, twice, in the strongest
   * terms available: "alle buttons sind nach wie vor nicht in der farb und
   * beschriftungs engine." Measured on the running app before touching anything:
   * every one of the eight buttons on a job card was `surface2` or `surface3`,
   * so the card's own hue reached none of them.
   *
   * The accent inherits from the card, which already rebinds it for its whole
   * subtree, so a row of these paints in its card's colour with no prop at all.
   * That is the sibling app's settled answer for the identical control, arrived
   * at there through the identical report about one grey tile among coloured
   * ones. "subtle" stays available for a control that genuinely stands outside a
   * card. Anything DESTRUCTIVE deliberately has no entry here: the design
   * language is explicit that a delete trigger takes the same treatment as the
   * controls beside it and carries its meaning in its glyph, its tip and the
   * window it opens.
   */
  tone?: 'subtle' | 'accent'
  /**
   * This control's own position in the palette.
   *
   * Almost never needed: a Card carrying a hueIndex already rebinds --accent
   * for its whole subtree, and custom properties inherit, so a row action
   * inside a card is painting in that card's colour with no prop at all. Pass
   * it only for a control that stands OUTSIDE every card, where there is no
   * colour to inherit and the rainbow reaches it through nothing.
   */
  hueIndex?: number
}) {
  return (
    <Button
      variant="icon"
      label={title}
      labelKey={labelKey}
      glyph={children}
      title={hint}
      tone={tone}
      hueIndex={hueIndex}
      className={size === 'key' ? 'glim-btn-key' : ''}
      disabled={disabled}
      busy={busy}
      onClick={onClick}
    />
  )
}
