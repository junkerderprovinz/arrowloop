// The Overview's word about a newer release. Only a container hears it there:
// the desktop app replaces itself and says so in its own toast, and the phone
// and a bare server have no daily check to find one.

import { useEffect, useState } from 'react'

import { api } from './api'
import { REPO } from './donate'
import { shownVersion } from './infoTile'

const KEY = 'arrowloop.releaseNotice.hidden'

export type ReleaseNotice = {
  /** The release's tag, which is what hiding the notice remembers. */
  tag: string
  version: string
  notes: string
}

type Versions = { deployment?: string; newRelease?: string }

/** The notice for what /api/versions answered, or null when there is none or it was hidden for this release. */
export function releaseNotice(versions: Versions | null, hidden: string | null): ReleaseNotice | null {
  const tag = versions?.newRelease
  if (versions?.deployment !== 'container' || !tag || tag === hidden) return null
  return { tag, version: shownVersion(tag), notes: `${REPO}/releases/tag/${encodeURIComponent(tag)}` }
}

function hiddenRelease(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** The notice as the engine and this browser have it, and the way to hide it until the next release. */
export function useReleaseNotice(): [ReleaseNotice | null, (tag: string) => void] {
  const [versions, setVersions] = useState<Versions | null>(null)
  const [hidden, setHidden] = useState(hiddenRelease)

  useEffect(() => {
    let live = true
    api
      .versions()
      .then((got) => live && setVersions(got))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const hide = (tag: string) => {
    setHidden(tag)
    try {
      localStorage.setItem(KEY, tag)
    } catch {
      // Without storage the notice stays hidden until the page reloads.
    }
  }
  return [releaseNotice(versions, hidden), hide]
}
