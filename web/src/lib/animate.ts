// The round-two animations of GlimStone's motion engine, wired to the page.
// The keyframes and the dials live in tokens.css; this only switches classes.

import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

/**
 * Plays a one-shot animation class again, also on an element that still has
 * it: taking the class off and forcing a style pass before putting it back
 * restarts the animation.
 */
export function replay(el: Element | null, cls: string): void {
  if (!el) return
  el.classList.remove(cls)
  void (el as HTMLElement).offsetWidth
  el.classList.add(cls)
}

/**
 * Lets the children of `box` arrive one after another. A child is counted the
 * first time it is seen, from the first new one on, so a row added to a list
 * already on screen comes in at once and the rows around it stay where they
 * are.
 */
export function useStagger(box: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    let arriving = 0
    for (const child of el.children) {
      if (child.classList.contains('glim-stagger-row')) continue
      ;(child as HTMLElement).style.setProperty('--row-i', String(arriving++))
      child.classList.add('glim-stagger-row')
    }
  })
}

/** A motion dial's current duration in milliseconds, 0 where no level sets it. */
function motionMs(dial: string): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(dial).trim()
  if (value.endsWith('ms')) return parseFloat(value) || 0
  return parseFloat(value) * 1000 || 0
}

let wipeTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Lets the next change of the rainbow wipe across the page instead of every
 * coloured element snapping on its own. The class stays only as long as the
 * wipe, so ordinary hovers keep their own timing, and a colour dragged in the
 * picker, which has to follow the pointer, never calls this.
 */
export function wipeColours(): void {
  const root = document.documentElement
  root.classList.add('glim-colour-wipe')
  clearTimeout(wipeTimer)
  wipeTimer = setTimeout(() => root.classList.remove('glim-colour-wipe'), motionMs('--motion-wipe-dur') + 50)
}

/**
 * Lets a change of shape morph the corners. Armed two frames after the first
 * paint, so the first radii never animate and every later change does.
 */
export function armShapeTransitions(): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => document.documentElement.classList.add('glim-shape-transitions')),
  )
}
