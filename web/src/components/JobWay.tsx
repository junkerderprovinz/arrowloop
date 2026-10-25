import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

import { brandMark } from './brandMarks'
import { DirectionSwitch } from './Direction'
import { Text } from './Field'
import { FolderPicker, type Known } from './FolderPicker'
import { IconFolder, IconTabStorage } from './glyphs'
import { Held } from './GlobalValues'
import type { Direction, Remote } from '../lib/api'
import { placeOf } from '../lib/entryLabel'
import { Button } from '../lib/glimstone/Button'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { useT } from '../lib/i18n'
import { isLocalTarget } from '../lib/localTarget'
import { usePlaces } from '../lib/places'

/**
 * The row's width below which the two sides stand one above the other: a
 * window of about 720 pixels less its padding, where two cards beside the
 * direction would leave a path a handful of characters.
 */
export const WAY_STACK_PX = 680

export function wayStacks(width: number): boolean {
  return width < WAY_STACK_PX
}

/** Whether the element is narrow enough to stack the sides, following it as it resizes. */
export function useStacked(el: RefObject<HTMLElement | null>): boolean {
  const [stacked, setStacked] = useState(false)
  useLayoutEffect(() => {
    const node = el.current
    if (!node) return
    setStacked(wayStacks(node.clientWidth))
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width !== undefined) setStacked(wayStacks(width))
    })
    watch.observe(node)
    return () => watch.disconnect()
  }, [el])
  return stacked
}

/**
 * Both sides of a job with the direction between them, which is how the job
 * reads: from here, that way, to there. Narrow, the sides stack and the arrow
 * turns to point from the upper one to the lower one.
 */
export function JobWay({
  left,
  right,
  direction,
  onLeft,
  onRight,
  onDirection,
  held,
  onHeld,
  known,
  remotes,
}: {
  left: string
  right: string
  direction: Direction
  onLeft: (path: string) => void
  onRight: (path: string) => void
  onDirection: (next: Direction) => void
  /** The direction comes from the global settings. */
  held: boolean
  onHeld: () => void
  known: Known[]
  remotes: Remote[]
}) {
  const { t } = useT()
  const row = useRef<HTMLDivElement>(null)
  const stacked = useStacked(row)
  return (
    <div
      ref={row}
      data-new="job-window"
      data-stacked={stacked || undefined}
      className={`flex gap-3 ${stacked ? 'flex-col items-stretch' : 'items-stretch'}`}
    >
      <SideCard label={t('edit.left')} path={left} onChange={onLeft} known={known} remotes={remotes} />
      <div className="flex shrink-0 flex-col items-center justify-center gap-1.5">
        <Held held={held} onHeld={onHeld}>
          <DirectionSwitch direction={direction} onChange={onDirection} vertical={stacked} />
        </Held>
        <InfoBubble tip={t('direction.hint')} />
      </div>
      <SideCard label={t('edit.right')} path={right} onChange={onRight} known={known} remotes={remotes} />
    </div>
  )
}

/** The mark and the name a side goes by: a target's own logo, or a folder on this device. */
function placeFace(path: string, remotes: Remote[], drives: { id: string; label: string }[]): { mark: ReactNode; name: string | null } {
  if (!path) return { mark: <IconFolder />, name: null }
  const place = placeOf(path, drives)
  if (place.kind === 'device') return { mark: <IconFolder />, name: null }
  if (place.kind === 'drive') return { mark: <IconTabStorage />, name: place.name }
  const remote = remotes.find((r) => r.name === place.name)
  if (remote && isLocalTarget(remote)) return { mark: <IconFolder />, name: place.name }
  return { mark: (remote?.mark && brandMark(remote.mark)) || <IconTabStorage />, name: place.name }
}

/**
 * One side as a card: the logo and name of where it is, the folder there, and
 * the picker that walks this machine, the registered drives and every target.
 */
function SideCard({
  label,
  path,
  onChange,
  known,
  remotes,
}: {
  label: string
  path: string
  onChange: (next: string) => void
  known: Known[]
  remotes: Remote[]
}) {
  const { t } = useT()
  const { drives } = usePlaces()
  const [picking, setPicking] = useState(false)
  const face = placeFace(path, remotes, drives)
  const name = face.name ?? (path ? t('side.onDevice') : t('edit.sideUnset'))

  return (
    <section className="glim-subcard flex min-w-0 flex-1 flex-col gap-3 px-4 pb-4 pt-3">
      <h3 data-glim-label={label} className="glim-eyebrow flex items-center gap-1.5 font-semibold">
        {label}
        <InfoBubble tip={t('edit.sideHint')} />
      </h3>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-carbon-surface3 text-[20px] text-accentGlyph">
          {face.mark}
        </span>
        <span className={`min-w-0 flex-1 text-body font-medium [overflow-wrap:anywhere] ${path ? 'text-carbon-text' : 'text-carbon-textMuted'}`}>
          {name}
        </span>
      </div>
      <Text value={path} onChange={onChange} label={label} mono />
      <div className="flex justify-end">
        <Button label={t('pick.open')} labelKey="pick.open" glyph={<IconFolder />} onClick={() => setPicking(true)} />
      </div>
      <FolderPicker
        open={picking}
        known={known}
        start={path}
        onClose={() => setPicking(false)}
        onPick={(next) => {
          onChange(next)
          setPicking(false)
        }}
      />
    </section>
  )
}
