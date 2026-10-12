// @vitest-environment jsdom
import { act, fireEvent, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { rangeIds, useRowSelection } from './rowSelection'

const plain = { shiftKey: false, ctrlKey: false, metaKey: false }
const ctrl = { ...plain, ctrlKey: true }
const shift = { ...plain, shiftKey: true }

describe('rangeIds', () => {
  it('runs from the anchor to the row either way round', () => {
    expect(rangeIds(['a', 'b', 'c', 'd'], 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(rangeIds(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['b', 'c', 'd'])
  })

  it('takes only the row when there is no anchor to start from', () => {
    expect(rangeIds(['a', 'b'], null, 'b')).toEqual(['b'])
    expect(rangeIds(['a', 'b'], 'gone', 'b')).toEqual(['b'])
  })
})

describe('useRowSelection', () => {
  const order = ['a', 'b', 'c', 'd']

  it('leaves a plain click to the row while nothing is picked', () => {
    const { result } = renderHook(() => useRowSelection(order))
    let took = true
    act(() => {
      took = result.current.click(plain, 'a')
    })
    expect(took).toBe(false)
    expect(result.current.selecting).toBe(false)
  })

  it('adds a row on Ctrl+click and a range on Shift+click', () => {
    const { result } = renderHook(() => useRowSelection(order))
    act(() => void result.current.click(ctrl, 'a'))
    act(() => void result.current.click(shift, 'c'))
    expect([...result.current.picked].sort()).toEqual(['a', 'b', 'c'])
  })

  it('picks with a plain click once something is picked', () => {
    const { result } = renderHook(() => useRowSelection(order))
    act(() => result.current.mark('a', false))
    let took = false
    act(() => {
      took = result.current.click(plain, 'd')
    })
    expect(took).toBe(true)
    expect([...result.current.picked].sort()).toEqual(['a', 'd'])
  })

  it('picks everything on Ctrl+A and lets go on Escape', () => {
    const { result } = renderHook(() => useRowSelection(order))
    act(() => void fireEvent.keyDown(document, { key: 'a', ctrlKey: true }))
    expect(result.current.allPicked).toBe(true)
    act(() => void fireEvent.keyDown(document, { key: 'Escape' }))
    expect(result.current.picked.size).toBe(0)
  })

  it('drops a row that leaves the list', () => {
    const { result, rerender } = renderHook(({ ids }) => useRowSelection(ids), { initialProps: { ids: order } })
    act(() => result.current.setAll(true))
    rerender({ ids: ['a', 'b'] })
    expect([...result.current.picked].sort()).toEqual(['a', 'b'])
  })
})
