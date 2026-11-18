// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { isTileMark } from '@glimstone/core'
import { afterEach, describe, expect, it } from 'vitest'

import { BRAND_TILES, IconShoutrrr } from './brandGlyphs'
import { brandMark, newOnMark, pickMark, tileMark } from './brandMarks'
import { IconServer } from './glyphs'

afterEach(cleanup)

type Shape = { tag: string; attrs: [string, string][]; kids: Shape[] }

/** An element as its tag, attributes and children, with styles read through the CSSOM so both spellings compare. */
function shape(el: Element): Shape {
  const attrs = [...el.attributes]
    .map((a): [string, string] => [a.name, a.name === 'style' ? (el as SVGElement).style.cssText : a.value])
    .sort(([a], [b]) => a.localeCompare(b))
  return { tag: el.tagName, attrs, kids: [...el.children].map(shape) }
}

function parsed(svg: string): Element {
  const box = document.createElement('div')
  box.innerHTML = svg
  return box.firstElementChild!
}

describe('a brand mark as markup', () => {
  it('draws every provider brand exactly as React does', () => {
    const brands = Object.keys(BRAND_TILES).filter((name) => isTileMark(pickMark(name)))
    expect(brands.length).toBeGreaterThan(40)
    for (const name of brands) {
      const drawn = render(<>{brandMark(name)}</>).container.firstElementChild!
      const mark = pickMark(name)
      expect(isTileMark(mark) && shape(parsed(mark.svg)), name).toEqual(shape(drawn))
      cleanup()
    }
  })

  it('draws the marks with gradients and styles too', () => {
    const drawn = render(<IconShoutrrr />).container.firstElementChild!
    expect(shape(parsed(tileMark(<IconShoutrrr />, BRAND_TILES.IconShoutrrr).svg))).toEqual(shape(drawn))
  })

  it("carries its brand's tile colours", () => {
    expect(pickMark('IconDropbox')).toMatchObject({ tile: '#0061ff', ink: '#ffffff' })
  })

  it("leaves one of the app's glyphs as it is, to light up in the accent", () => {
    expect(isTileMark(pickMark('IconServer'))).toBe(false)
  })
})

describe("a What's new dot on a mark", () => {
  it('stands on an HTML element around a brand', () => {
    const mark = newOnMark(pickMark('IconSynology'), 'provider-marks')
    const el = isTileMark(mark) ? parsed(mark.svg) : null
    expect(el?.tagName).toBe('SPAN')
    expect(el?.getAttribute('data-new')).toBe('provider-marks')
    expect(el?.querySelector('svg')).not.toBeNull()
  })

  it("stands on an HTML element around one of the app's glyphs", () => {
    const { container } = render(<>{newOnMark(<IconServer />, 'provider-marks')}</>)
    expect(container.querySelector('span[data-new="provider-marks"] > svg')).not.toBeNull()
  })
})
