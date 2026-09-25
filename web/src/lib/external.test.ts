// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { followExternal, openExternal, popupsWork } from './external';

function desktop(platform: string) {
  const runtime = {
    BrowserOpenURL: vi.fn(),
    Environment: vi.fn(async () => ({ buildType: 'production', platform, arch: 'amd64' })),
  };
  (window as unknown as { runtime?: typeof runtime }).runtime = runtime;
  return runtime;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { runtime?: unknown }).runtime;
  vi.restoreAllMocks();
});

describe('openExternal', () => {
  it('opens a tab without an opener in a browser', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('https://github.com/junkerderprovinz/arrowloop');
    expect(open).toHaveBeenCalledWith('https://github.com/junkerderprovinz/arrowloop', '_blank', 'noopener,noreferrer');
  });

  it('hands a mail address to the system in the desktop build', () => {
    const runtime = desktop('linux');
    const open = vi.spyOn(window, 'open');
    openExternal('mailto:hello@halleluja.design?subject=ArrowLoop%20Feedback');
    expect(runtime.BrowserOpenURL).toHaveBeenCalledWith('mailto:hello@halleluja.design?subject=ArrowLoop%20Feedback');
    expect(open).not.toHaveBeenCalled();
  });
});

describe('followExternal', () => {
  const APK = 'https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-android-arm64.apk';

  /** Clicks an anchor wired the way the App tab wires its links, and says whether the browser would still follow it. */
  function clickAnchor(href: string): boolean {
    const { container } = render(createElement('a', { href, target: '_blank', onClick: followExternal }, 'APK'));
    return fireEvent.click(container.querySelector('a')!);
  }

  it('leaves the anchor to the browser', () => {
    expect(clickAnchor(APK)).toBe(true);
  });

  it('sends the anchor to the system browser in the desktop build', () => {
    const runtime = desktop('darwin');
    expect(clickAnchor(APK)).toBe(false);
    expect(runtime.BrowserOpenURL).toHaveBeenCalledWith(APK);
  });
});

describe('popupsWork', () => {
  it('is true in a browser', async () => {
    expect(await popupsWork()).toBe(true);
  });

  it.each([
    ['windows', true],
    ['darwin', false],
    ['linux', false],
  ])('in the desktop build on %s is %s', async (platform, works) => {
    desktop(platform);
    expect(await popupsWork()).toBe(works);
  });
});
