// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { Job } from '../lib/api'
import { JobStatusLine } from './JobStatusLine'

afterEach(cleanup)

const camera: Job = {
  name: 'camera',
  left: '/a',
  right: '/b',
  direction: 'leftToRight',
  schedule: '',
  watch: false,
  disabled: false,
  running: false,
  lastSuccess: null,
  recent: [],
  includesNothing: true,
}

describe('JobStatusLine', () => {
  it('warns of a job that takes no files and says why', () => {
    render(<JobStatusLine job={camera} status="empty" />)
    const badge = screen.getByText('Takes no files')
    expect(badge.closest('[title]')?.getAttribute('title')).toMatch(/shared lists this job includes are empty/)
  })
})
