// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { JobMark } from './JobMark'

afterEach(cleanup)

describe('the mark', () => {
  it.each([
    ['running', 'Running'],
    ['failed', 'Failed'],
    ['paused', 'Paused'],
    ['stopped', 'Stopped'],
    ['ok', 'Ready'],
  ] as const)('names a %s job the way its badge does', (status, name) => {
    render(<JobMark status={status} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(name)
  })
})
