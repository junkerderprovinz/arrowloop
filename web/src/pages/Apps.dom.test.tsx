// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { DOWNLOADS } from '../lib/downloads'
import { Apps } from './Apps'

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as unknown as typeof ResizeObserver

afterEach(cleanup)

function download(name: string) {
  const link = screen.getByRole('link', { name })
  return { href: link.getAttribute('href'), words: link.textContent }
}

describe('the desktop downloads', () => {
  it('name the system once and the ARM build in a segment beside it, as the README does', () => {
    render(<Apps version="v1.8.0" desktop={false} />)
    expect(download('Windows x64')).toEqual({ href: DOWNLOADS.windows, words: 'Windowsx64' })
    expect(download('Windows ARM64')).toEqual({ href: DOWNLOADS.windowsArm, words: 'ARM64' })
    expect(download('Linux x64')).toEqual({ href: DOWNLOADS.linux, words: 'Linuxx64' })
    expect(download('Linux ARM64')).toEqual({ href: DOWNLOADS.linuxArm, words: 'ARM64' })
  })

  it('offer the universal macOS app as a disk image and as a zip beside it', () => {
    render(<Apps version="v1.8.0" desktop={false} />)
    expect(download('macOS Apple and Intel')).toEqual({ href: DOWNLOADS.macos, words: 'macOSApple and Intel' })
    expect(download('macOS Zip')).toEqual({
      href: 'https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-macos-universal.zip',
      words: 'Zip',
    })
  })

  it('keep the architecture on a second line of its own, which the button shows under the pointer', () => {
    render(<Apps version="v1.8.0" desktop={false} />)
    const sub = screen.getByRole('link', { name: 'Windows x64' }).querySelector('.glim-readme-btn-sub')
    expect(sub?.textContent).toBe('x64')
  })

  it('offer the Flatpak for both architectures', () => {
    render(<Apps version="v1.8.0" desktop={false} />)
    expect(download('Flatpak x64')).toEqual({
      href: 'https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-linux-amd64.flatpak',
      words: 'Flatpakx64',
    })
    expect(download('Flatpak ARM64')).toEqual({
      href: 'https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-linux-arm64.flatpak',
      words: 'ARM64',
    })
  })
})
