// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ListHead, ListSearch, nextSort, type Head, type ListSort } from './ListHead'
import { useColumns } from '../lib/columns'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

function List({ page = 'test' }: { page?: string }) {
  const [sort, setSort] = useState<ListSort>({ by: 'name', dir: 'asc' })
  const [narrow, setNarrow] = useState(false)
  const [query, setQuery] = useState('')
  const area = useRef<HTMLDivElement>(null)
  const heads: Head[] = [
    { id: 'name', label: 'Name', sorts: true },
    {
      id: 'kind',
      label: 'Kind',
      filter: {
        active: narrow,
        panel: (
          <button type="button" onClick={() => setNarrow(true)}>
            Only pictures
          </button>
        ),
      },
    },
  ]
  return (
    <div ref={area} tabIndex={-1} data-testid="area">
      <ListSearch value={query} onChange={setQuery} placeholder="Name" area={area} />
      <ListHead heads={heads} sort={sort} onSort={setSort} page={page} search />
      <output data-testid="sort">{`${sort.by} ${sort.dir}`}</output>
    </div>
  )
}

describe('a list head', () => {
  it('flips the order on the head that sorts and starts another head from the top', () => {
    expect(nextSort({ by: 'name', dir: 'asc' }, 'name')).toEqual({ by: 'name', dir: 'desc' })
    expect(nextSort({ by: 'name', dir: 'desc' }, 'size')).toEqual({ by: 'size', dir: 'asc' })
    expect(nextSort(undefined, 'size')).toEqual({ by: 'size', dir: 'asc' })
  })

  it('sorts on a click and says which way', () => {
    render(<List />)
    const name = screen.getByRole('button', { name: 'Name' })
    expect(name.getAttribute('aria-sort')).toBe('ascending')
    fireEvent.click(name)
    expect(screen.getByTestId('sort').textContent).toBe('name desc')
    expect(name.getAttribute('aria-sort')).toBe('descending')
  })

  it('opens the filter under the ▾ and marks the head while it narrows', () => {
    render(<List />)
    const caret = screen.getByRole('button', { name: 'Filter by Kind' })
    expect(caret.querySelector('.bg-accent')).toBeNull()
    fireEvent.click(caret)
    expect(document.querySelector('.glim-modal-backdrop')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Only pictures' }))
    expect(caret.querySelector('.bg-accent')).toBeTruthy()
  })

  it('explains itself by itself on the first visit only', () => {
    const { unmount } = render(<List />)
    const line = () => screen.queryAllByRole('note').find((n) => !n.className.includes('hidden'))
    expect(line()?.textContent).toContain('Click a heading to sort by it.')
    expect(line()?.textContent).toContain('Start typing, or press Ctrl+F, to search.')
    expect(line()?.textContent).not.toContain('Right-click')
    unmount()
    render(<List />)
    expect(line()).toBeUndefined()
  })

  it('goes quiet once a head is used', () => {
    render(<List page="other" />)
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })
})

describe('the list search', () => {
  it('opens with the character somebody typed in the list', () => {
    render(<List />)
    expect(screen.queryByRole('searchbox')).toBeNull()
    fireEvent.keyDown(screen.getByTestId('area'), { key: 'p' })
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('p')
  })

  it('opens on Ctrl+F with the caret in it', () => {
    render(<List />)
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true })
    expect(document.activeElement).toBe(screen.getByRole('searchbox'))
  })

  it('empties and closes on Escape, handing the focus back to the list', () => {
    render(<List />)
    fireEvent.keyDown(screen.getByTestId('area'), { key: 'p' })
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('area'))
  })

  it('has no button of its own under a mouse', () => {
    render(<List />)
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
  })

  it('opens from a magnifier in the head on a touch-only device, which the hint names', () => {
    const plain = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query === '(hover: none) and (pointer: coarse)',
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia
    try {
      render(<List page="touch" />)
      const line = screen.queryAllByRole('note').find((n) => !n.className.includes('hidden'))
      expect(line?.textContent).toContain('The magnifier searches the list.')
      expect(line?.textContent).not.toContain('Ctrl+F')
      fireEvent.click(screen.getByRole('button', { name: 'Search' }))
      expect(document.activeElement).toBe(screen.getByRole('searchbox'))
    } finally {
      window.matchMedia = plain
    }
  })
})

describe('a list with columns', () => {
  const defs = [{ id: 'name', width: 200 }, { id: 'kind', width: 120 }, { id: 'path' }]

  function Table() {
    const columns = useColumns('test', defs)
    const heads: Head[] = [
      { id: 'name', label: 'Name' },
      { id: 'kind', label: 'Kind' },
      { id: 'path', label: 'Path' },
    ]
    return (
      <div ref={(el) => void (columns.host.current = el)} style={columns.style} data-testid="host">
        <ListHead heads={heads} columns={columns} />
      </div>
    )
  }

  const order = () => screen.getAllByRole('columnheader').sort((a, b) => Number(a.style.order) - Number(b.style.order)).map((h) => h.textContent)
  const stored = () => JSON.parse(localStorage.getItem('arrowloop.columns.test') ?? '{}')

  it('moves a column that is dragged onto another', () => {
    render(<Table />)
    const kind = screen.getByText('Kind')
    const name = screen.getAllByRole('columnheader')[0]
    name.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect
    fireEvent.dragStart(kind, { dataTransfer: { setData() {}, effectAllowed: '' } })
    fireEvent.dragOver(name)
    fireEvent.drop(name, { clientX: 20 })
    expect(order()).toEqual(['Kind', 'Name', 'Path'])
    expect(stored().order).toEqual(['kind', 'name', 'path'])
  })

  it('moves the focused head with Alt and an arrow key', () => {
    render(<Table />)
    fireEvent.keyDown(screen.getByText('Name'), { key: 'ArrowRight', altKey: true })
    expect(order()).toEqual(['Kind', 'Name', 'Path'])
  })

  it('widens a column by its handle and gives the width back on a double click', () => {
    render(<Table />)
    const handle = screen.getAllByRole('separator')[0]
    Object.defineProperty(handle.parentElement, 'offsetWidth', { value: 200 })
    fireEvent.pointerDown(handle, { clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 260, pointerId: 1 })
    expect(screen.getByTestId('host').style.getPropertyValue('--list-cols')).toContain('260px')
    fireEvent.pointerUp(handle, { clientX: 260, pointerId: 1 })
    expect(stored().widths).toEqual({ name: 260 })
    fireEvent.doubleClick(handle)
    expect(stored().widths).toEqual({})
  })

  it('has no handle on the column that takes the rest', () => {
    render(<Table />)
    expect(screen.getAllByRole('separator')).toHaveLength(2)
  })
})
