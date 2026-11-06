import { describe, expect, it } from 'vitest'

import { byJobOrder, jobNamesInOrder, stepJob } from './jobOrder'

describe('the job order', () => {
  it('follows the job list, with a job it does not hold after the others by name', () => {
    expect(['gone', 'photos', 'Archiv', 'music'].sort(byJobOrder(['photos', 'music']))).toEqual([
      'photos',
      'music',
      'Archiv',
      'gone',
    ])
  })

  it('names every job once', () => {
    expect(jobNamesInOrder(['music', 'photos', 'music', 'old'], ['photos', 'music'])).toEqual(['photos', 'music', 'old'])
  })

  it('steps a job one place and stops at either end', () => {
    expect(stepJob(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(stepJob(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(stepJob(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(stepJob(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
  })
})
