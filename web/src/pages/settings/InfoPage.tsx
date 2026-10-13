import { useEffect, useState, type ReactNode } from 'react'

import { About } from '../../components/About'
import { IconGithub } from '../../components/brandGlyphs'
import { IconDiagnostics } from '../../components/glyphs'
import { Stack } from '../../components/Shell'
import { api, ApiError } from '../../lib/api'
import { MAIL_SVG, MANUAL_SVG } from '../../lib/appMarks'
import { download } from '../../lib/download'
import { GLIMSTONE_REPO, MAIL, MANUAL, RCLONE_REPO, REPO } from '../../lib/donate'
import { openExternal } from '../../lib/external'
import { InfoVersionCard } from '../../lib/glimstone/AboutCard'
import { Card } from '../../lib/glimstone/Card'
import { BrandMark, ReadmeButton } from '../../lib/glimstone/ReadmeButton'
import { GLIMSTONE_VERSION } from '../../lib/glimstone/version'
import { useT, type TranslationKey } from '../../lib/i18n'
import { useToast } from '../../lib/toast'
import { openNewsWindow } from '../../lib/whatsNewStore'

const REFUSED: Record<string, TranslationKey> = {
  'dev-build': 'info.refusedDevBuild',
  offline: 'info.refusedOffline',
  'rate-limited': 'info.refusedRateLimited',
  'bad-response': 'info.refusedBadResponse',
}

/**
 * The last tile: every version this build is made of with the ways to the
 * release notes and to what the last update changed, the ways to report a
 * problem, and the maker's card.
 */
export function InfoPage({ version, whatsNew }: { version: string; whatsNew?: ReactNode }) {
  const { t } = useT()
  const push = useToast()
  const [versions, setVersions] = useState<{ arrowloop: string; rclone: string } | null>(null)

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

  const updateCheck = async (): Promise<number> => {
    try {
      const got = await api.updateCheck()
      if (got.updateAvailable) push(t('info.available', { version: got.latest }))
      return got.updateAvailable ? 1 : 0
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined
      push(code && REFUSED[code] ? t(REFUSED[code]) : (e as Error).message, 'fail')
      throw e
    }
  }

  const bugReport = () => {
    api
      .diagnostics()
      .then((text) => download(`arrowloop-report-${new Date().toISOString().slice(0, 10)}.json`, text, 'application/json'))
      .catch((e: Error) => push(e.message, 'fail'))
  }

  return (
    <Stack>
      <div data-new="info-tile">
        <InfoVersionCard
          hueIndex={0}
          openUrl={openExternal}
          text={{
            title: t('about.version'),
            hint: t('info.versionHint'),
            unreleased: (v) => t('about.unreleased', { version: v }),
            releaseNotes: t('about.releaseNotes'),
          }}
          rows={[
            { name: 'ArrowLoop', version: versions?.arrowloop ?? version, repoUrl: REPO },
            { name: 'GlimStone', sub: t('info.glimstoneSub'), version: GLIMSTONE_VERSION, repoUrl: GLIMSTONE_REPO },
            ...(versions ? [{ name: 'rclone', sub: t('info.rcloneSub'), version: versions.rclone, repoUrl: RCLONE_REPO }] : []),
          ]}
          updateCheck={{
            run: updateCheck,
            text: {
              check: t('info.check'),
              upToDate: t('info.upToDate'),
              updatesFound: () => t('info.updateFound'),
              checkFailed: t('info.checkFailed'),
            },
          }}
          onReleaseNotes={() => openNewsWindow('notes')}
          whatsNew={whatsNew}
        />
      </div>

      {/* Built here rather than with the reference Help card, which offers
          Email only where the sentence spells out "email" and so drops it in
          most of the languages here. */}
      <Card title={t('info.help')} hint={t('info.helpHint')} hueIndex={1}>
        <p className="text-body text-carbon-textSub">{t('about.report')}</p>
        <div className="glim-readme-btn-rows">
          <ReadmeButton
            brand="github"
            parts={[{ name: t('about.repo'), onClick: () => openExternal(REPO) }]}
            mark={<IconGithub />}
            markClass="glim-github-mark"
          />
          {/* Subject only: a prefilled body reads as a form to fill in. */}
          <ReadmeButton
            brand="house"
            parts={[
              {
                name: t('about.mail'),
                onClick: () => openExternal(`mailto:${MAIL}?subject=${encodeURIComponent(`ArrowLoop ${t('about.mailSubject')}`)}`),
              },
            ]}
            mark={<BrandMark svg={MAIL_SVG} />}
            markClass="glim-house-mark"
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

      <About hueIndex={2} />
    </Stack>
  )
}
