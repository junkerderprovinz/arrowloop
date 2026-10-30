import { useEffect, useState } from 'react'

import { drawsOwnFrame, frame, resizeFromEdges } from '../lib/desk'
import { WindowBar } from '../lib/glimstone/WindowBar'
import { useT } from '../lib/i18n'

/** How long the page has to stop resizing before the window is asked whether it is maximised. */
const SETTLE_MS = 100

/**
 * Follows whether the window is maximised. Maximising and restoring resize the
 * page whatever started them, the bar, a snap or a key, so a resize that has
 * settled is the cue to ask.
 */
function useMaximised(): boolean {
  const [maximised, setMaximised] = useState(false)
  useEffect(() => {
    let timer: number | undefined
    const ask = () => void frame.maximised().then(setMaximised, () => {})
    const settle = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(ask, SETTLE_MS)
    }
    ask()
    window.addEventListener('resize', settle)
    return () => {
      window.removeEventListener('resize', settle)
      window.clearTimeout(timer)
    }
  }, [])
  return maximised
}

/** The desktop main window's title bar, where the window has no native one. */
export function WindowFrame() {
  return drawsOwnFrame() ? <Frame /> : null
}

function Frame() {
  const { t } = useT()
  const maximised = useMaximised()
  // A maximised window has no edge to pull, and its corner belongs to close.
  useEffect(() => (maximised ? undefined : resizeFromEdges()), [maximised])
  const quiet = (call: () => Promise<void>) => () => void call().catch(() => {})
  return (
    <WindowBar
      appName="ArrowLoop"
      maximised={maximised}
      text={{
        minimise: t('frame.minimise'),
        maximise: t('frame.maximise'),
        restore: t('frame.restore'),
        close: t('frame.close'),
      }}
      onMinimise={quiet(frame.minimise)}
      onToggleMaximise={quiet(frame.toggleMaximise)}
      onClose={quiet(frame.close)}
      onDragStart={frame.drag}
    />
  )
}
