import { useState } from 'react'

import { AboutCard } from '../lib/glimstone/AboutCard'
import { CoffeeDonate } from './CoffeeDonate'
import { CryptoDonate } from './CryptoDonate'
import { PaypalDonate } from './PaypalDonate'
import { IconBitcoin, IconPayPal } from './donateMarks'
import { BrandMark } from '../lib/glimstone/ReadmeButton'
import { COFFEE_BUTTON_SVG, MAIL_SVG } from '../lib/appMarks'
import { GLIMSTONE_VERSION } from '../lib/glimstone/version'
import { IconGithub } from './brandGlyphs'
import { GLIMSTONE_REPO, MAIL, PAYPAL, REPO } from '../lib/donate'
import { openExternal, popupsWork } from '../lib/external'
import { useT } from '../lib/i18n'

/** GlimStone's About card, handed this app's strings, links and version. */
export function About({ version, hueIndex }: { version: string | null; hueIndex: number }) {
  const { t } = useT()
  const [open, setOpen] = useState<'coffee' | 'paypal' | 'crypto' | null>(null)
  const close = () => setOpen(null)
  return (
    <>
      <AboutCard
        version={version}
        glimstoneVersion={GLIMSTONE_VERSION}
        repoUrl={REPO}
        // Brand marks are passed rather than resolved from the label key: a
        // rule keyed on "repo", "coffee" or "crypto" would put a company's logo
        // on settings that have nothing to do with it.
        repoGlyph={<IconGithub />}
        glimstoneRepoUrl={GLIMSTONE_REPO}
        onCoffee={() => setOpen('coffee')}
        coffeeArt={<BrandMark svg={COFFEE_BUTTON_SVG} />}
        cryptoGlyph={<IconBitcoin />}
        onCrypto={() => setOpen('crypto')}
        // The window's wallet button logs in through a popup. Where the webview
        // cannot open one, PayPal's own donation page does the whole job.
        onPaypal={async () => {
          if (await popupsWork()) setOpen('paypal')
          else openExternal(PAYPAL)
        }}
        paypalGlyph={<IconPayPal />}
        mailAddress={MAIL}
        mailGlyph={<BrandMark svg={MAIL_SVG} />}
        openUrl={openExternal}
        hueIndex={hueIndex}
        text={{
          title: t('about.title'),
          body: t('about.body'),
          coffee: t('about.coffee'),
          coffeeButton: t('about.coffeeButton'),
          cryptoButton: t('about.crypto'),
          paypalButton: t('about.paypal'),
          report: t('about.report'),
          repoButton: t('about.repo'),
          mailButton: t('about.mail'),
          mailSubject: `ArrowLoop ${t('about.mailSubject')}`,
          version: t('about.version'),
          unreleased: (v) => t('about.unreleased', { version: v }),
        }}
      />
      {open === 'coffee' && <CoffeeDonate onClose={close} />}
      {open === 'paypal' && <PaypalDonate onClose={close} />}
      {open === 'crypto' && <CryptoDonate onClose={close} />}
    </>
  )
}
