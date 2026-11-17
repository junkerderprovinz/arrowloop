import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { Dialog } from './Dialog'
import { PickerSearch } from './PickerSearch'

export type PickerSection = { id: string; title: string; body: ReactNode }

/**
 * A picker window: the choices in sections under a search that narrows all of
 * them at once. The caller does the narrowing and leaves out a section the
 * search has emptied; with none left, `none` stands in their place.
 */
export function PickerWindow({
  title,
  hint,
  hueIndex,
  query,
  onQuery,
  searchLabel,
  sections,
  none,
  onClose,
}: {
  title: string
  hint?: string
  hueIndex?: number
  query: string
  onQuery: (next: string) => void
  searchLabel: string
  sections: PickerSection[]
  none: ReactNode
  onClose: () => void
}) {
  // While a query narrows the tiles the window keeps the height it opened
  // with, or the search would move away from the eye with every letter.
  const body = useRef<HTMLDivElement>(null)
  const [floor, setFloor] = useState<number>()
  useLayoutEffect(() => {
    const scroller = body.current?.parentElement
    if (!scroller || floor !== undefined) return
    const style = getComputedStyle(scroller)
    setFloor(scroller.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom))
  }, [floor])

  return (
    <Dialog
      title={title}
      hint={hint}
      hueIndex={hueIndex}
      onClose={onClose}
      width="wide"
      search={<PickerSearch value={query} onChange={onQuery} label={searchLabel} />}
    >
      <div ref={body} className="flex flex-col gap-6" style={{ minHeight: floor }}>
        {sections.length === 0 ? (
          <p className="py-6 text-center text-subline text-carbon-textMuted">{none}</p>
        ) : (
          sections.map((s) => (
            <section key={s.id} className="flex flex-col gap-3">
              <h3 className="glim-eyebrow">{s.title}</h3>
              {s.body}
            </section>
          ))
        )}
      </div>
    </Dialog>
  )
}
