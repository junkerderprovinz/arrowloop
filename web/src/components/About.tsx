import { Card } from './Shell'
import { useT } from '../lib/i18n'

/**
 * The version of this build, and the version of the design language it is built
 * against.
 *
 * The card exists rather than a quiet line of page chrome because of what
 * somebody does NEXT with a version number: they report something. Chrome has
 * nowhere to put that, so the number sat at the bottom of the screen as a dead
 * end. Here the number and the way to say something about it are one thing.
 *
 * This is the one card whose body is prose rather than an info bubble, and that
 * is deliberate: a bubble hangs an explanation off a control, and this card has
 * no control to explain. The sentence is not an explanation of anything, it is
 * the content.
 */
const REPO = 'https://github.com/junkerderprovinz/arrowloop'

/**
 * The design language this interface is built against.
 *
 * Written here and nowhere else, and it must match the header every copied
 * reference file carries. It is a version somebody bumps by hand because the
 * files are copied by hand; the app's own version is read from the build, which
 * is why that one is not written down anywhere on this page.
 */
const GLIMSTONE = '1.6.0'
const GLIMSTONE_REPO = 'https://github.com/junkerderprovinz/glimstone'

export function About({ version }: { version: string }) {
  const { t } = useT()
  // A version that is not a released tag gets no link to a release page. A link
  // is only a link if something is behind it, and an unreleased build sends the
  // reader to a tag page at best and a 404 at worst.
  const released = /^v?\d+\.\d+\.\d+$/.test(version)
  const tag = version.startsWith('v') ? version : `v${version}`

  return (
    <Card title={t('about.title')} hue={8}>
      <p className="text-[12px] text-carbon-textMuted">{t('about.body')}</p>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-[12px]">
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-carbon-textMuted">
            {t('about.version')}
          </dt>
          <dd className="glim-num">
            {released ? (
              <a
                href={`${REPO}/releases/tag/${tag}`}
                target="_blank"
                rel="noreferrer"
                className="text-accentInk hover:brightness-110"
              >
                {version}
              </a>
            ) : (
              <span className="text-carbon-textMuted">{t('about.unreleased', { version })}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-carbon-textMuted">
            {t('about.glimstone')}
          </dt>
          <dd className="glim-num">
            <a
              href={`${GLIMSTONE_REPO}/releases/tag/v${GLIMSTONE}`}
              target="_blank"
              rel="noreferrer"
              className="text-accentInk hover:brightness-110"
            >
              {GLIMSTONE}
            </a>
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <a
          href={`${REPO}/issues`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 bg-carbon-surface2 px-3 py-1.5 text-[12px] font-medium text-carbon-text transition hover:bg-carbon-hover"
          style={{ borderRadius: 'var(--radius-pill)' }}
        >
          {t('about.repo')}
        </a>
        {/* Subject only, no body: a prefilled body reads as a form to fill in,
            and this is meant to be a message somebody writes. */}
        <a
          href={`mailto:jdp@braethoria.com?subject=${encodeURIComponent(`ArrowLoop ${version}`)}`}
          className="inline-flex items-center gap-1.5 bg-carbon-surface2 px-3 py-1.5 text-[12px] font-medium text-carbon-text transition hover:bg-carbon-hover"
          style={{ borderRadius: 'var(--radius-pill)' }}
        >
          {t('about.mail')}
        </a>
      </div>
    </Card>
  )
}
