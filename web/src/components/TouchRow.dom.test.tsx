// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { Touch } from '../lib/api'
import { TouchRow } from './TouchRow'

afterEach(cleanup)

describe('a line of the file log', () => {
  it('spells out the day and the time, as the runs beside it do', () => {
    const when = new Date()
    when.setHours(6, 12, 0, 0)
    const touch = { Job: 'photos', When: when.toISOString(), Seq: 1, Kind: 'copy', Side: 'right', Path: 'a.txt', Size: 10, Note: '' } as Touch
    render(
      <ul>
        <TouchRow touch={touch} />
      </ul>,
    )
    expect(screen.getByText(/^Today, /)).toBeTruthy()
    expect(screen.queryByText(/ago$/)).toBeNull()
  })
})
