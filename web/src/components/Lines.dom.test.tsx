// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Lines } from './Field'

afterEach(cleanup)

function Held({ start }: { start: string[] }) {
  const [list, setList] = useState(start)
  return (
    <>
      <Lines value={list} onChange={setList} />
      <output>{JSON.stringify(list)}</output>
      <button onClick={() => setList(['*.bak'])}>reset</button>
    </>
  )
}

describe('a field with one entry per line', () => {
  it('keeps a new line that is still empty', () => {
    render(<Held start={['.fuse_hidden*', 'Temp/**']} />)
    const field = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(field, { target: { value: '.fuse_hidden*\nTemp/**\n' } })
    expect(field.value).toBe('.fuse_hidden*\nTemp/**\n')
    fireEvent.change(field, { target: { value: '.fuse_hidden*\nTemp/**\n*.part' } })
    expect(field.value).toBe('.fuse_hidden*\nTemp/**\n*.part')
    expect(screen.getByRole('status').textContent).toBe('[".fuse_hidden*","Temp/**","*.part"]')
  })

  it('leaves blank lines and spaces out of the list', () => {
    render(<Held start={[]} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  a  \n\n b\n' } })
    expect(screen.getByRole('status').textContent).toBe('["a","b"]')
  })

  it('shows a list that changed elsewhere', () => {
    render(<Held start={['a']} />)
    fireEvent.click(screen.getByRole('button', { name: 'reset' }))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('*.bak')
  })
})
