import { useState } from 'react'

import { InfoAboutCard } from '../lib/glimstone/AboutCard'
import { CoffeeDonate } from './CoffeeDonate'
import { CryptoDonate } from './CryptoDonate'
import { PaypalDonate } from './PaypalDonate'
import { IconBitcoin, IconPayPal } from './donateMarks'
import { BrandMark } from '../lib/glimstone/ReadmeButton'
import { COFFEE_BUTTON_SVG } from '../lib/appMarks'
import { PAYPAL } from '../lib/donate'
import { openExternal, popupsWork } from '../lib/external'
import { useT } from '../lib/i18n'

/** The last card of the Info tile: who made the app, and the three ways to give. */
export function About({ hueIndex }: { hueIndex: number }) {
  const { t } = useT()
  const [open, setOpen] = useState<'coffee' | 'paypal' | 'crypto' | null>(null)
  const close = () => setOpen(null)
  return (
    <>
      <InfoAboutCard
        onCoffee={() => setOpen('coffee')}
        coffeeArt={<BrandMark svg={COFFEE_BUTTON_SVG} />}
        // Brand marks are passed rather than resolved from the label key: a
        // rule keyed on "coffee" or "crypto" would put a company's logo on
        // settings that have nothing to do with it.
        cryptoGlyph={<IconBitcoin />}
        onCrypto={() => setOpen('crypto')}
        // The window's wallet button logs in through a popup. Where the webview
        // cannot open one, PayPal's own donation page does the whole job.
        onPaypal={async () => {
          if (await popupsWork()) setOpen('paypal')
          else openExternal(PAYPAL)
        }}
        paypalGlyph={<IconPayPal />}
        hueIndex={hueIndex}
        text={{
          title: t('about.title'),
          body: t('about.body'),
          coffee: t('about.coffee'),
          coffeeButton: t('about.coffeeButton'),
          cryptoButton: t('about.crypto'),
          paypalButton: t('about.paypal'),
        }}
      />
      {open === 'coffee' && <CoffeeDonate onClose={close} />}
      {open === 'paypal' && <PaypalDonate onClose={close} />}
      {open === 'crypto' && <CryptoDonate onClose={close} />}
    </>
  )
}
