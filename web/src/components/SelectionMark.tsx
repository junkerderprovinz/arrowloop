import { IconCheck } from './glyphs'

/**
 * The round mark a row is picked with: grey at rest, filled with the accent
 * and ticked once its row is chosen. To a screen reader it is a checkbox; to
 * the eye it is part of the row, never a form field. `.glim-select-mark` in
 * index.css decides when it shows.
 */
export function SelectionMark({
  checked,
  onPick,
  label,
}: {
  checked: boolean
  /** `range` is a Shift press, which picks everything up to this row. */
  onPick: (range: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onPick(e.shiftKey)
      }}
      className={`glim-select-mark grid h-[18px] w-[18px] flex-none place-items-center rounded-full transition-colors [&_svg]:h-2.5 [&_svg]:w-2.5 ${
        checked ? 'bg-accent text-accentContrast' : 'bg-carbon-surface3 text-transparent hover:bg-carbon-hoverRaised'
      }`}
    >
      <IconCheck />
    </button>
  )
}
