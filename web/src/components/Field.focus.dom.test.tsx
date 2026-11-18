// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Choice, Day, Lines, NumberField, Secret, Text } from './Field'

afterEach(cleanup)

// A lighter ground washes a focused box out on the light theme, where the
// fields are already near white, so a box keeps its ground and gains the ring.
const RING = ['outline-solid', 'outline-2', 'outline-offset-2', 'outline-(--focus-ring)']

function wearsTheRing(el: Element, on: 'focus' | 'focus-visible') {
  const classes = [...el.classList]
  expect(classes.filter((c) => c.includes('brightness')), el.outerHTML).toEqual([])
  expect(classes).toContain('bg-carbon-surface2')
  for (const ring of RING) expect(classes, el.outerHTML).toContain(`${on}:${ring}`)
}

describe('a focused field', () => {
  it('keeps its box and wears the focus ring, whatever it holds', () => {
    render(
      <>
        <Text value="Nextcloud" onChange={() => {}} label="Name" />
        <Day value="2026-11-18" onChange={() => {}} label="Day" />
        <NumberField value={3} onChange={() => {}} label="Count" />
        <Lines value={['a']} onChange={() => {}} />
        <Secret value="" onChange={() => {}} label="Password" />
      </>,
    )
    for (const box of [
      screen.getByLabelText('Name'),
      screen.getByLabelText('Day'),
      screen.getByLabelText('Count'),
      document.querySelector('textarea')!,
      screen.getByLabelText('Password'),
    ]) {
      wearsTheRing(box, 'focus')
    }
  })

  it('rings a picker when the keyboard reaches it', () => {
    render(<Choice label="Mode" value="a" onChange={() => {}} options={[{ value: 'a', label: 'A' }]} />)
    wearsTheRing(screen.getByRole('button', { name: 'Mode' }), 'focus-visible')
  })

  it('is drawn the same way everywhere else in the app', () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), '..')
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) && !name.includes('.test.') ? [path] : []
      })
    const washed = files(src).filter((file) => /focus(-visible)?:brightness-/.test(readFileSync(file, 'utf8')))
    expect(washed.map((file) => file.slice(src.length + 1))).toEqual([])
  })
})
