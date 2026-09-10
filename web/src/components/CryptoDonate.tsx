import { useEffect, useRef, useState } from 'react'

import { CryptoDonateDialog, type CryptoChain } from '../lib/glimstone/CryptoDonateDialog'
import { QRCode } from './QRCode'
import { CRYPTO_CHAINS } from '../lib/donate'
import { useT } from '../lib/i18n'

/**
 * The crypto window's stateful half, the same split every dialog here uses: the
 * design language owns the markup and the rules, this file owns the parts a
 * language cannot know about — which chain is picked, Escape, focus, and what
 * "copied" says in this app's words.
 *
 * The QR encoder is handed in rather than imported by the language, which has
 * no dependencies and is not going to grow one. See lib/donate.ts for the one
 * rule that matters about the list itself: it is grouped by CHAIN, never by
 * coin, and a coin whose chain has no address is simply absent.
 */
export function CryptoDonate({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  const [picked, setPicked] = useState(CRYPTO_CHAINS[0]!)
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

  const chain: CryptoChain = {
    ...picked,
    note: picked.noteKey ? t(picked.noteKey) : undefined,
  }

  return (
    <CryptoDonateDialog
      chains={CRYPTO_CHAINS.map((c) => ({ ...c, note: c.noteKey ? t(c.noteKey) : undefined }))}
      picked={chain}
      onPick={(next) => {
        setPicked(CRYPTO_CHAINS.find((c) => c.id === next.id) ?? CRYPTO_CHAINS[0]!)
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
      onCopy={(c) => {
        void navigator.clipboard?.writeText(c.address).then(() => setCopied(true))
      }}
      onClose={onClose}
      ref={cardRef}
    />
  )
}
