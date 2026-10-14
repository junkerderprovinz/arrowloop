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

  it('keeps the height of a path that wraps when its list is short of room', () => {
    const path = 'Serien/Dublin Murders/Dublin.Murders.2019.S01E07.1080p.BluRay.HEVC.x265.5.1-BONE.mkv'
    const touch = { Job: 'video', When: new Date().toISOString(), Seq: 1, Kind: 'copy', Side: 'right', Path: path, Size: 931135488, Note: '' } as Touch
    render(
      <ul className="flex max-h-96 flex-col overflow-y-auto">
        <TouchRow touch={touch} />
      </ul>,
    )
    const row = screen.getByText(path).closest('li')!
    expect(row.classList.contains('shrink-0')).toBe(true)
  })
})
