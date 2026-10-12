/**
 * The figure on a navigation entry. Its colours are the entry's own and come
 * from index.css (`.glim-nav-count`), which also turns them round on the
 * current entry. `quiet` is the grey the bottom bar uses, since the bar keeps
 * colour for the tab that is current.
 */
export function NavCount({
  value,
  quiet = false,
  className = '',
}: {
  value: number
  quiet?: boolean
  className?: string
}) {
  return (
    <span
      className={`glim-nav-count${quiet ? ' glim-nav-count--quiet' : ''} glim-num inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[var(--radius-pill)] px-1.5 text-meta font-semibold leading-none ${className}`}
    >
      {value}
    </span>
  )
}
