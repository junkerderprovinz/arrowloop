// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ListHead, ListSearch, nextSort, type Head, type ListSort } from './ListHead'

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
      <ListHead heads={heads} sort={sort} onSort={setSort} page={page} menu />
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
    fireEvent.click(screen.getByRole('button', { name: 'Only pictures' }))
    expect(caret.querySelector('.bg-accent')).toBeTruthy()
  })

  it('explains itself by itself on the first visit only', () => {
    const { unmount } = render(<List />)
    const line = () => screen.queryAllByRole('note').find((n) => !n.className.includes('hidden'))
    expect(line()?.textContent).toContain('Click a heading to sort by it.')
    expect(line()?.textContent).toContain('Right-click for more.')
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

  it('has no button of its own', () => {
    render(<List />)
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
  })
})
