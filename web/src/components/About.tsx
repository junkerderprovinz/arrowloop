import { Card } from './Shell'
import { useT } from '../lib/i18n'

/**
 * The house About card, in the order GlimStone lays down for it: what this is,
 * then the coffee with its own button, then the way to report something with
 * its own buttons, then the versions as a footer.
 *
 * The card exists rather than a quiet line of page chrome because of what
 * somebody does NEXT with a version number: they report something. Chrome has
 * nowhere to put that, so the number sat at the bottom of the screen as a dead
 * end. Here the number and the ways to say something about it are one thing.
 *
 * Each sentence sits directly above the thing it asks for. Three sentences
 * stacked over one row of buttons reads as a form; a sentence with its own
 * button under it reads as one offer.
 *
 * This is the one card whose body is prose rather than an info bubble, and that
 * is deliberate: a bubble hangs an explanation off a control, and this card has
 * no control to explain. The sentences are not an explanation of anything, they
 * are the content.
 */
const REPO = 'https://github.com/junkerderprovinz/arrowloop'
/** The workshop's own mailbox, shared by every tool in it: the subject carries
 *  the product name, so one inbox can tell them apart. Not a private address,
 *  which is the point of having it. */
const MAIL = 'hello@halleluja.design'
/** The handle from .github/FUNDING.yml, so one place in the product knows it. */
const COFFEE = 'https://buymeacoffee.com/junkerderprovinz'

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

/** The card's anchors, dressed identically. One constant rather than the same
 *  eighty characters repeated per link: buttons that are supposed to be one
 *  object should not be three chances to drift. */
const BTN =
  'inline-flex items-center gap-1.5 bg-carbon-surface2 px-3 py-1.5 text-[12px] font-medium' +
  ' text-carbon-text transition hover:bg-carbon-hover'

export function About({ version }: { version: string }) {
  const { t } = useT()
  // A version that is not a released tag gets no link to a release page. A link
  // is only a link if something is behind it, and an unreleased build sends the
  // reader to a tag page at best and a 404 at worst.
  const released = /^v?\d+\.\d+\.\d+$/.test(version)
  const tag = version.startsWith('v') ? version : `v${version}`

  return (
    <Card title={t('about.title')} hue={8}>
      <p className="max-w-2xl text-[12px] text-carbon-textMuted">{t('about.body')}</p>

      <p className="mt-3 max-w-2xl text-[12px] text-carbon-textMuted">{t('about.coffee')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <a
          href={COFFEE}
          target="_blank"
          rel="noreferrer noopener"
          className={BTN}
          style={{ borderRadius: 'var(--radius-pill)' }}
        >
          {t('about.coffeeButton')}
        </a>
      </div>

      {/* One extra step of space above this line, and only above this one
          (jdp, 2026-09-06). The card holds two offers, and without the break
          the coffee button sits as close to the next sentence as to the one it
          belongs to, so the eye pairs it with the wrong text. */}
      <p className="mt-5 max-w-2xl text-[12px] text-carbon-textMuted">{t('about.report')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* Anchors dressed as buttons rather than buttons that navigate: one
            opens a site and one hands off to a mail client, and both want the
            browser's own middle-click, copy-link and open-in-new-tab. */}
        <a
          href={`${REPO}/issues`}
          target="_blank"
          rel="noreferrer noopener"
          className={BTN}
          style={{ borderRadius: 'var(--radius-pill)' }}
        >
          {t('about.repo')}
        </a>
        {/* Subject only, no body: a prefilled body reads as a form to fill in,
            and this is meant to be a message somebody writes. */}
        <a
          href={`mailto:${MAIL}?subject=${encodeURIComponent(`ArrowLoop ${t('about.mailSubject')}`)}`}
          className={BTN}
          style={{ borderRadius: 'var(--radius-pill)' }}
        >
          {t('about.mail')}
        </a>
      </div>

      {/* Last line in the card, under the buttons. It reads as a footer, which
          is what it is: the sentences above are what the card wants to say and
          each has its own button, while a build number is what somebody looks
          up afterwards. One line with a middle dot, not two rows: two rows read
          as two facts of equal weight that happen to sit together, and this is
          one fact about one build.

          Both numbers link to their own release page. A version answers "which
          build is this"; the question straight after it is always "and what
          changed". */}
      <p className="glim-num mt-5 text-[11px] text-carbon-textMuted">
        {t('about.version')}{' '}
        {released ? (
          <a
            href={`${REPO}/releases/tag/${tag}`}
            target="_blank"
            rel="noreferrer"
            className="text-carbon-textMuted no-underline hover:text-carbon-text"
          >
            {version}
          </a>
        ) : (
          t('about.unreleased', { version })
        )}
        {' · GlimStone '}
        <a
          href={`${GLIMSTONE_REPO}/releases/tag/v${GLIMSTONE}`}
          target="_blank"
          rel="noreferrer"
          className="text-carbon-textMuted no-underline hover:text-carbon-text"
        >
          {GLIMSTONE}
        </a>
      </p>
    </Card>
  )
}
