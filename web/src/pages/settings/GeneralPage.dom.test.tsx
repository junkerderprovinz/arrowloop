// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WindowSettings } from '../../lib/api'

vi.mock('../../lib/api', async (actual) => ({
  ...(await actual<typeof import('../../lib/api')>()),
  api: {
    settings: () => Promise.resolve({}),
    saveSettings: () => Promise.resolve({}),
    autoBackups: () => Promise.resolve({ on: false, folder: '', files: [], last: null }),
  },
}))
vi.mock('../../lib/toast', () => ({ useToast: () => () => {} }))

const { GeneralPage } = await import('./GeneralPage')

afterEach(cleanup)

const windowSettings: WindowSettings = {
  tray: false,
  closeToTray: false,
  minimiseToTray: false,
  startWithSystem: false,
  canStartWithSystem: true,
  autoUpdate: false,
  updatesFromStore: false,
}

describe('the General tile', () => {
  it('keeps the window and start switches and leaves updates to the Info tile', () => {
    render(<GeneralPage window={windowSettings} onWindow={() => {}} />)
    expect(screen.getByRole('switch', { name: 'Icon in the notification area' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Start with the system' })).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'Update automatically' })).toBeNull()
    expect(screen.queryByText('Updates come through your software centre')).toBeNull()
  })
})
