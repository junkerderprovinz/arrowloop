import { AboutCard } from '../lib/glimstone/AboutCard'
import { useT } from '../lib/i18n'

/**
 * The About card, which is now GlimStone's own file with this app's strings
 * handed to it.
 *
 * It used to be built here, from the language's prose, and that is exactly the
 * dialect the language's React folder exists to end: three apps read the same
 * section and produced three different cards, one leading with the sentence,
 * one with the versions, one with a two-column list of labelled fields. The
 * order is the standard, not the markup, so the order now arrives with the
 * component rather than being re-derived per app.
 *
 * Everything app-shaped stays here: the language, the repository, the mailbox
 * and the version. The card fetches nothing.
 */

const REPO = 'https://github.com/junkerderprovinz/arrowloop'
const GLIMSTONE_REPO = 'https://github.com/junkerderprovinz/glimstone'

/** The workshop's own mailbox, shared by every tool here: the subject carries
 *  the product name, so one inbox can tell them apart. Not a private address,
 *  which is the point of having it. */
const MAIL = 'hello@halleluja.design'

/** The handle from .github/FUNDING.yml, so one place in the product knows it. */
const COFFEE = 'https://buymeacoffee.com/junkerderprovinz'

/**
 * The design language this interface is built against.
 *
 * Bumped by hand, because the files in `lib/glimstone/` are copied by hand. It
 * has to match what was actually copied: a number claiming a release the code
 * is not built from is worse than no number, because it sends somebody to the
 * wrong changelog.
 *
 * 1.7.2 and not 1.7.3, deliberately, and the same reason as last time: the
 * files in `lib/glimstone/` and `tokens.css` ARE 1.7.3, but 1.7.3 is a commit
 * on the language's main branch and not a release yet. The language's own rule
 * is that a number on screen must be a published release, never a tag without
 * one, because the number is a link and the link has to lead somewhere. It
 * moves the day that release is cut.
 */
const GLIMSTONE = '1.7.2'

export function About({ version }: { version: string | null }) {
  const { t } = useT()
  return (
    <AboutCard
      version={version}
      glimstoneVersion={GLIMSTONE}
      repoUrl={REPO}
      glimstoneRepoUrl={GLIMSTONE_REPO}
      coffeeUrl={COFFEE}
      mailAddress={MAIL}
      hueIndex={0}
      text={{
        title: t('about.title'),
        body: t('about.body'),
        coffee: t('about.coffee'),
        coffeeButton: t('about.coffeeButton'),
        report: t('about.report'),
        repoButton: t('about.repo'),
        mailButton: t('about.mail'),
        mailSubject: `ArrowLoop ${t('about.mailSubject')}`,
        version: t('about.version'),
        unreleased: (v) => t('about.unreleased', { version: v }),
      }}
    />
  )
}
