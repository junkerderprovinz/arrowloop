import { componentText, type ComponentRow, type UpdateRoute, type UpdateState } from '@glimstone/core'
import { useEffect, useMemo, useState } from 'react'

import { About } from '../../components/About'
import { IconDiscord, IconGithub } from '../../components/brandGlyphs'
import { IconDiagnostics } from '../../components/glyphs'
import { Stack } from '../../components/Shell'
import { api, ApiError, type DeskUpdate, type Deployment, type WindowSettings } from '../../lib/api'
import { MANUAL_SVG } from '../../lib/appMarks'
import { onUpdateReady } from '../../lib/desk'
import { download } from '../../lib/download'
import { DISCORD, MANUAL, POMMELPORTER_REPO, RCLONE_REPO, REPO } from '../../lib/donate'
import { openExternal } from '../../lib/external'
import { InfoComponentsCard, InfoVersionCard } from '../../lib/glimstone/AboutCard'
import { Card } from '../../lib/glimstone/Card'
import { BrandMark, ReadmeButton } from '../../lib/glimstone/ReadmeButton'
import { useT, type TranslationKey } from '../../lib/i18n'
import { shownVersion } from '../../lib/infoTile'
import { useToast } from '../../lib/toast'
import { openNewsWindow, useWhatsNew } from '../../lib/whatsNewStore'
import { useEngineSettings } from './engineSettings'

const REFUSED: Record<string, TranslationKey> = {
  'dev-build': 'info.refusedDevBuild',
  offline: 'info.refusedOffline',
  'rate-limited': 'info.refusedRateLimited',
  'bad-response': 'info.refusedBadResponse',
}

/** Where a container learns how to update, which it cannot do from inside. */
const GUIDE = `${MANUAL}installing/#updates`

type Versions = Awaited<ReturnType<typeof api.versions>>

/**
 * How this copy gets a new version: the desktop app installs its own, a
 * Flatpak and the phone leave it to their store, and a container or a server
 * is updated the way it was deployed.
 */
export function routeOf(deployment: Deployment | undefined, windowSettings: WindowSettings | null): { route: UpdateRoute; store?: string } {
  if (windowSettings) return windowSettings.updatesFromStore ? { route: 'store', store: 'Flathub' } : { route: 'install' }
  if (deployment === 'phone' || deployment === 'android') return { route: 'store', store: 'F-Droid' }
  return { route: 'guide' }
}

/**
 * What the Version card shows: the desktop app's own update while it has one
 * under way or in place, otherwise what the last check found.
 */
export function stateOf(route: UpdateRoute, store: string | undefined, checked: UpdateState, desk: DeskUpdate | null): UpdateState {
  if (route === 'store') return { kind: 'store', store }
  if (desk?.ready) return { kind: 'ready', version: shownVersion(desk.ready) }
  if (desk?.busy) return desk.percent >= 0 ? { kind: 'downloading', percent: desk.percent } : { kind: 'checking' }
  if (desk?.failed) return { kind: 'failed', reason: desk.failed }
  return checked
}

/** What the server remembers of its last check. */
function lastCheck(v: Versions): UpdateState {
  if (v.newRelease) return { kind: 'available', version: shownVersion(v.newRelease) }
  return v.checkedAt ? { kind: 'current', checkedAt: new Date(v.checkedAt) } : { kind: 'unchecked' }
}

/**
 * The last tile: the Version card with how this copy updates, the Components
 * card with what it brings along, the ways to report a problem, and the
 * maker's card.
 */
export function InfoPage({
  version,
  window: windowSettings,
  onWindow,
}: {
  version: string
  /** Null on a build with no window of its own. */
  window: WindowSettings | null
  onWindow: (next: WindowSettings) => void
}) {
  const { t, lang } = useT()
  const push = useToast()
  const words = useMemo(() => componentText(lang), [lang])
  const [versions, setVersions] = useState<Versions | null>(null)
  const [checked, setChecked] = useState<UpdateState>({ kind: 'unchecked' })
  const [desk, setDesk] = useState<DeskUpdate | null>(null)
  const news = useWhatsNew()
  const engine = useEngineSettings()

  const { route, store } = routeOf(versions?.deployment, windowSettings)
  const selfUpdating = route === 'install'

  useEffect(() => {
    let live = true
    api
      .versions()
      .then((got) => {
        if (!live) return
        setVersions(got)
        setChecked(lastCheck(got))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  // The desktop app's own update: where it stands when the tile opens, every
  // second while a download runs, and the moment the shell has it in place.
  const following = selfUpdating && desk?.busy === true
  useEffect(() => {
    if (!selfUpdating) return
    let live = true
    const read = () =>
      api
        .windowUpdate()
        .then((got) => live && setDesk(got))
        .catch(() => {})
    void read()
    const poll = following ? window.setInterval(read, 1000) : undefined
    const stop = onUpdateReady((ready) => live && setDesk((d) => ({ percent: -1, ...d, busy: false, ready })))
    return () => {
      live = false
      window.clearInterval(poll)
      stop()
    }
  }, [selfUpdating, following])

  const check = async () => {
    setChecked({ kind: 'checking' })
    setDesk((d) => d && { ...d, failed: undefined })
    try {
      const got = await api.updateCheck()
      setChecked(got.updateAvailable ? { kind: 'available', version: shownVersion(got.latest) } : { kind: 'current', checkedAt: new Date() })
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined
      setChecked({ kind: 'failed', reason: code && REFUSED[code] ? t(REFUSED[code]) : (e as Error).message })
    }
  }

  const update = () =>
    api
      .startUpdate()
      .then(setDesk)
      .catch((e: Error) => push(e.message, 'fail'))

  const restart = () => api.restart().catch((e: Error) => push(e.message, 'fail'))

  const state = stateOf(route, store, checked, desk)
  // A new version's notes are not in this build, so they open on its release page.
  const coming = state.kind === 'available' || state.kind === 'ready' ? state.version : null
  const whatsNew = () => (coming ? openExternal(`${REPO}/releases/tag/v${coming}`) : openNewsWindow())

  const autoUpdate =
    route === 'install' && windowSettings
      ? windowSettings.autoUpdate
      : route === 'guide' && engine.loaded
        ? engine.draft.updateCheck === true
        : undefined
  const setAutoUpdate = (on: boolean) => {
    if (route === 'install' && windowSettings) onWindow({ ...windowSettings, autoUpdate: on })
    else engine.patch({ updateCheck: on })
  }

  const rows: ComponentRow[] = versions
    ? [
        { name: 'rclone', kind: 'tool', hint: t('info.rcloneHint'), version: versions.rclone, repoUrl: RCLONE_REPO },
        ...(versions.installer
          ? [{ name: 'PommelPorter', kind: 'installer' as const, hint: words.componentsCard.installer, version: versions.installer, repoUrl: POMMELPORTER_REPO }]
          : []),
      ]
    : []

  const bugReport = () => {
    api
      .diagnostics()
      .then((text) => download(`arrowloop-report-${new Date().toISOString().slice(0, 10)}.json`, text, 'application/json'))
      .catch((e: Error) => push(e.message, 'fail'))
  }

  return (
    <Stack>
      <InfoVersionCard
        hueIndex={0}
        openUrl={openExternal}
        text={words.versionCard}
        name="ArrowLoop"
        version={versions?.arrowloop ?? version}
        repoUrl={REPO}
        route={route}
        state={state}
        onCheck={() => void check()}
        onUpdate={() => void update()}
        onRestart={() => void restart()}
        guideUrl={GUIDE}
        onWhatsNew={whatsNew}
        unseen={news?.unseen.length ?? 0}
        autoUpdate={autoUpdate}
        onAutoUpdateChange={setAutoUpdate}
      />

      <InfoComponentsCard hueIndex={1} openUrl={openExternal} text={words.componentsCard} name="ArrowLoop" rows={rows} />

      {/* Built here rather than with the reference Help card so the bug
          report's mark takes GitHub's colour beside the issue button. */}
      <Card title={t('info.help')} hint={t('info.helpHint')} hueIndex={2}>
        <p className="text-body text-carbon-textSub">{t('about.report')}</p>
        <div className="glim-readme-btn-rows">
          <ReadmeButton
            brand="github"
            parts={[{ name: t('about.repo'), onClick: () => openExternal(REPO) }]}
            mark={<IconGithub />}
            markClass="glim-github-mark"
          />
          <ReadmeButton
            brand="discord"
            parts={[{ name: t('about.discord'), onClick: () => openExternal(DISCORD) }]}
            mark={<IconDiscord />}
            markClass="glim-discord-mark"
          />
          {/* The README's docs button, its book and its yellow. */}
          <ReadmeButton
            brand="docs"
            parts={[{ name: t('info.manual'), sub: t('settings.open'), onClick: () => openExternal(MANUAL) }]}
            mark={<BrandMark svg={MANUAL_SVG} />}
            markClass="glim-docs-mark"
          />
          {/* The file goes with an issue on GitHub, so it lights up beside it. */}
          <ReadmeButton
            brand="github"
            parts={[{ name: t('info.bugReport'), sub: t('info.download'), onClick: bugReport }]}
            mark={<IconDiagnostics />}
            markClass="glim-github-mark"
          />
        </div>
      </Card>

      <About hueIndex={3} />
    </Stack>
  )
}
