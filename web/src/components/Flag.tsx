/**
 * A country flag from the flag-icons sprite. The regional-indicator emoji is
 * not an option, since Windows draws it as a two-letter tag.
 */
export function Flag({ code }: { code: string }) {
  return (
    <span
      className={`fi fi-${code}`}
      aria-hidden
      style={{ width: '1.25em', height: '1em', display: 'inline-block', flexShrink: 0 }}
    />
  )
}
