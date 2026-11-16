// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { JobStatusLine } from '../components/JobStatusLine'
import type { Job } from './api'
import { I18nProvider, useT } from './i18n'

const KEY = 'arrowloop.lang'

function browserSpeaks(...tags: string[]) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(tags)
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(tags[0])
}

function Locale() {
  return <output>{useT().locale}</output>
}

const photos = {
  name: 'Photos',
  disabled: false,
  running: false,
  recent: [{ Finished: new Date(2026, 10, 3, 14, 5).toISOString() }],
} as unknown as Job

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 15, 9, 0))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('dates', () => {
  it('follow the browser region while the words follow the chosen language', () => {
    browserSpeaks('en-GB')
    localStorage.setItem(KEY, 'de')
    render(<I18nProvider><Locale /></I18nProvider>)
    expect(screen.getByRole('status').textContent).toBe('de-GB')
  })

  it('are written day first in English on a British browser', () => {
    browserSpeaks('en-GB', 'en')
    localStorage.setItem(KEY, 'en')
    render(
      <I18nProvider>
        <JobStatusLine job={photos} status="last" />
      </I18nProvider>,
    )
    expect(screen.getByText('03/11, 14:05')).toBeTruthy()
  })
})
