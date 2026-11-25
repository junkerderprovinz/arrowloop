import { describe, expect, it } from 'vitest'

import { addList, handOver, jobsUsing, offered, pickSet, setSide, stranded, takesNothing } from './sharedLists'

describe('pickSet', () => {
  it('adds a list to the side it was picked on', () => {
    expect(pickSet({}, 'Photos', 'include', true)).toEqual({ includeSets: ['Photos'], excludeSets: undefined })
  })

  it('takes a list off the other side, so a job never includes and excludes it at once', () => {
    const job = { excludeSets: ['Photos', 'junk'] }
    expect(pickSet(job, 'Photos', 'include', true)).toEqual({ includeSets: ['Photos'], excludeSets: ['junk'] })
  })

  it('drops a list without touching the other side', () => {
    const job = { includeSets: ['Photos'], excludeSets: ['junk'] }
    expect(pickSet(job, 'Photos', 'include', false)).toEqual({ includeSets: undefined, excludeSets: ['junk'] })
  })
})

describe('takesNothing', () => {
  it('is true when every include list is empty and the job has no inclusions of its own', () => {
    expect(takesNothing({ includeSets: ['Photos'] }, ['Photos'])).toBe(true)
  })

  it('is false when one include list still has patterns', () => {
    expect(takesNothing({ includeSets: ['Photos', 'Videos'] }, ['Photos'])).toBe(false)
  })

  it('is false when the job has inclusions of its own', () => {
    expect(takesNothing({ includeSets: ['Photos'], include: ['*.pdf'] }, ['Photos'])).toBe(false)
  })

  it('is false for a job that includes no lists, since that one takes every file', () => {
    expect(takesNothing({}, ['Photos'])).toBe(false)
  })
})

describe('addList', () => {
  it('adds an empty list under the trimmed name', () => {
    expect(addList({ junk: ['*.tmp'] }, '  Photos ')).toEqual({ junk: ['*.tmp'], Photos: [] })
  })

  it('refuses a blank name and one already taken, which would empty that list', () => {
    expect(addList({ junk: ['*.tmp'] }, '   ')).toBeNull()
    expect(addList({ junk: ['*.tmp'] }, 'junk')).toBeNull()
  })
})

describe('offered', () => {
  it('leaves out the lists the other side has picked', () => {
    expect(offered(['Photos', 'Videos', 'junk'], { excludeSets: ['junk'] }, 'include')).toEqual(['Photos', 'Videos'])
    expect(offered(['Photos', 'Videos', 'junk'], { includeSets: ['Photos'] }, 'exclude')).toEqual(['Videos', 'junk'])
  })

  it('keeps the lists this side has picked', () => {
    expect(offered(['Photos', 'junk'], { includeSets: ['Photos'] }, 'include')).toEqual(['Photos', 'junk'])
  })
})

describe('setSide', () => {
  it('writes one side and drops what it took from the other', () => {
    expect(setSide({ excludeSets: ['junk', 'Photos'] }, 'include', ['Photos'])).toEqual({ includeSets: ['Photos'], excludeSets: ['junk'] })
  })

  it('leaves a side without lists undefined, so an older engine sees no new key', () => {
    expect(setSide({ includeSets: ['Photos'] }, 'include', [])).toEqual({ includeSets: undefined, excludeSets: undefined })
  })
})

describe('jobsUsing', () => {
  const jobs = [
    { name: 'camera', includeSets: ['Photos'] },
    { name: 'rest', excludeSets: ['Photos', 'junk'] },
    { name: 'docs', include: ['*.pdf'] },
  ]

  it('counts every job that includes or excludes the list', () => {
    expect(jobsUsing(jobs, 'Photos')).toBe(2)
    expect(jobsUsing(jobs, 'junk')).toBe(1)
  })

  it('counts the job being edited by what it picks now rather than what it saved', () => {
    expect(jobsUsing(jobs, 'junk', { name: 'docs', excludeSets: ['junk'] })).toBe(2)
    expect(jobsUsing(jobs, 'Photos', { name: 'camera' })).toBe(1)
  })
})

describe('handOver', () => {
  const jobs = [
    { name: 'camera', include: ['*.dng'], includeSets: ['Photos'] },
    { name: 'rest', excludeSets: ['Photos', 'junk'] },
    { name: 'docs', include: ['*.pdf'] },
  ]

  it('gives every job that used a list its patterns as its own, so it takes the same files', () => {
    expect(handOver(jobs, 'Photos', ['*.jpg', '*.dng'])).toEqual([
      { name: 'camera', include: ['*.dng', '*.jpg'], includeSets: undefined },
      { name: 'rest', exclude: ['*.jpg', '*.dng'], excludeSets: ['junk'] },
      { name: 'docs', include: ['*.pdf'] },
    ])
  })
})

describe('stranded', () => {
  it('names a job whose only inclusions would go with an empty list', () => {
    const jobs = [
      { name: 'videos', includeSets: ['Videos'] },
      { name: 'mixed', includeSets: ['Videos', 'Photos'] },
      { name: 'own', include: ['*.mp4'], includeSets: ['Videos'] },
    ]
    expect(stranded(jobs, 'Videos', [])).toEqual(['videos'])
  })

  it('names nobody when the list brings patterns along', () => {
    expect(stranded([{ name: 'videos', includeSets: ['Videos'] }], 'Videos', ['*.mp4'])).toEqual([])
  })
})
