// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { SearchFold } from './ListBar'

afterEach(cleanup)

function Search({ start = '' }: { start?: string }) {
  const [value, setValue] = useState(start)
  return <SearchFold value={value} onChange={setValue} placeholder="Path" />
}

const field = () => screen.getByRole('searchbox')

describe('a search on a page', () => {
  it('starts as a button that turns into the field', () => {
    render(<Search />)
    expect(screen.queryByRole('searchbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(document.activeElement).toBe(field())
  })

  it('opens on Ctrl+F', () => {
    render(<Search />)
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true })
    expect(document.activeElement).toBe(field())
  })

  it('empties on Escape, then folds back with the focus on the button', () => {
    render(<Search start="docs" />)
    field().focus()
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect((field() as HTMLInputElement).value).toBe('')
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Search' }))
  })

  it('stays a field while it holds a query', () => {
    render(<Search start="docs" />)
    fireEvent.blur(field())
    expect(field()).toBeTruthy()
  })
})
