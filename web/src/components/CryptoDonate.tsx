import { useEffect, useRef, useState } from 'react'

import { CryptoDonateDialog } from '../lib/glimstone/CryptoDonateDialog'
import { CoinMark } from './donateMarks'
import { QRCode } from './QRCode'
import { CRYPTO_COINS, type CryptoCoin, type CryptoNetwork } from '../lib/donate'
import { useT } from '../lib/i18n'

/**
 * The crypto window's stateful half, the same split every dialog here uses: the
 * design language owns the markup and the rules, this file owns the parts a
 * language cannot know about — which coin and chain are picked, Escape, focus,
 * and what "copied" says in this app's words.
 *
 * The QR encoder and the coin marks are handed in rather than imported by the
 * language, which has no dependencies and no right to hand out somebody else's
 * logo. See lib/donate.ts for the one rule that matters about the list itself:
 * every network a donor can pick carries its OWN address, so a chain we cannot
 * receive on is unofferable rather than merely discouraged.
 */
export function CryptoDonate({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  const [coin, setCoin] = useState<CryptoCoin>(CRYPTO_COINS[0]!)
  const [network, setNetwork] = useState<CryptoNetwork>(CRYPTO_COINS[0]!.networks[0]!)
  const [copied, setCopied] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    cardRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // The label flips for a moment and goes back, which is how every other copy
  // control in this app answers. No toast system here to push to, and a line
  // of feedback that appears somewhere else on the page would be worse than
  // the button saying it itself.
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(id)
  }, [copied])

  return (
    <CryptoDonateDialog
      coins={CRYPTO_COINS.map((c) => ({
        ...c,
        networks: c.networks.map((n) => ({ ...n, note: n.noteKey ? t(n.noteKey) : undefined })),
      }))}
      coin={coin}
      network={{ ...network, note: network.noteKey ? t(network.noteKey) : undefined }}
      onPick={(nextCoin, nextNetwork) => {
        setCoin(CRYPTO_COINS.find((c) => c.id === nextCoin.id) ?? CRYPTO_COINS[0]!)
        setNetwork(nextNetwork)
        setCopied(false)
      }}
      text={{
        title: t('about.cryptoTitle'),
        intro: t('about.cryptoIntro'),
        networks: t('about.cryptoNetworks'),
        copyLabel: copied ? t('common.copied') : t('common.copy'),
        closeLabel: t('common.close'),
      }}
      renderQr={(value) => <QRCode value={value} size={168} />}
      renderMark={(c) => <CoinMark coin={c.id} size={22} />}
      onCopy={(_, n) => {
        void navigator.clipboard?.writeText(n.address).then(() => setCopied(true))
      }}
      onClose={onClose}
      ref={cardRef}
    />
  )
}
