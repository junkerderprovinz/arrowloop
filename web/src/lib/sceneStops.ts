// The pointer that walks over three step cards lives above their grid, so its
// stops have to be measured in the grid's own pixels and handed to the
// stylesheet (`.al-scene-pointer` in index.css).

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

/** A stop: the card, and a place in its picture's own 240 by 130 units. */
export type SceneStops = Record<string, [card: number, x: number, y: number]>

/** Where an element lies inside an ancestor, by layout alone. A card that is
 *  still sliding in would shift what its bounding box reports. */
function placeWithin(el: HTMLElement, root: HTMLElement): [number, number] {
  let x = 0
  let y = 0
  for (let at: HTMLElement | null = el; at && at !== root; at = at.offsetParent as HTMLElement | null) {
    x += at.offsetLeft
    y += at.offsetTop
  }
  return [x, y]
}

/** How wide a step card has to be for its heading badges to stay on one line,
 *  with the room StepCard leaves beside them. */
function headingWidth(root: HTMLElement): number {
  const heads = Array.from(root.querySelectorAll<HTMLElement>('h2'))
  if (heads.length === 0) return 0
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const widths = heads.map((head) => {
    const badges = Array.from(head.children as HTMLCollectionOf<HTMLElement>)
    const gap = parseFloat(getComputedStyle(head).columnGap) || 0
    return badges.reduce((sum, badge) => sum + badge.scrollWidth, 0) + gap * (badges.length - 1)
  })
  return Math.ceil(Math.max(0, ...widths) + 3.25 * rem)
}

/**
 * Measures the pointer's stops in the grid's pixels as --at-*, and the width a
 * step card needs for its heading to stay on one line, again whenever the grid
 * changes size or `words` changes.
 */
export function useSceneStops(points: SceneStops, words = '') {
  const grid = useRef<HTMLDivElement>(null)
  const [stops, setStops] = useState<CSSProperties>({})
  const [stepMin, setStepMin] = useState(0)
  useLayoutEffect(() => {
    const root = grid.current
    if (!root) return
    const measure = () => {
      setStepMin(headingWidth(root))
      const frames = Array.from(root.querySelectorAll<HTMLElement>('[data-step-frame]'))
      const next: Record<string, string> = {}
      for (const [name, [card, x, y]] of Object.entries(points)) {
        const frame = frames[card]
        if (!frame) return
        const [left, top] = placeWithin(frame, root)
        const scale = frame.offsetWidth / 240
        next[`--at-${name}-x`] = `${(left + x * scale).toFixed(1)}px`
        next[`--at-${name}-y`] = `${(top + y * scale).toFixed(1)}px`
      }
      setStops((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : (next as CSSProperties)))
    }
    measure()
    // The badges are measured in the page's font, which can arrive later.
    void document.fonts?.ready.then(measure)
    const watch = new ResizeObserver(measure)
    watch.observe(root)
    return () => watch.disconnect()
  }, [points, words])
  return { grid, stops, stepMin }
}
