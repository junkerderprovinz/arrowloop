// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LearningRings } from './LearningRings'
import { LEARN_AFTER } from '../lib/anomalies'

afterEach(cleanup)

const lit = (ring: Element) => [...ring.querySelectorAll('circle[data-lit="true"]')].map((c) => c.getAttribute('class'))

describe('the learning rings', () => {
  // A green accent would make a ring still filling look like a full one.
  it('draw a ring still filling in the info colour, whatever the accent', () => {
    const { container } = render(
      <LearningRings learning={[{ job: 'photos', runs: LEARN_AFTER / 2 }]} onOpen={() => undefined} />,
    )
    const parts = lit(container.querySelector('li')!)
    expect(parts.length).toBeGreaterThan(0)
    expect(parts.every((c) => c?.includes('stroke-statusInfoSolid') && !c.includes('accent'))).toBe(true)
  })

  it('draw a full ring in green', () => {
    const { container } = render(
      <LearningRings learning={[{ job: 'photos', runs: LEARN_AFTER }]} onOpen={() => undefined} />,
    )
    expect(lit(container.querySelector('li')!).every((c) => c?.includes('stroke-statusOkSolid'))).toBe(true)
  })

  it('give the legend the same two colours', () => {
    const { container } = render(<LearningRings learning={[]} onOpen={() => undefined} />)
    const dots = [...container.querySelectorAll('i')].map((i) => i.getAttribute('class'))
    expect(dots[0]).toContain('var(--status-info-solid)')
    expect(dots[1]).toContain('var(--status-ok-solid)')
  })
})
