import { useEffect, useRef, useState } from 'react'

import { CryptoDonateDialog } from '../lib/glimstone/CryptoDonateDialog'
import { CoinMark } from './donateMarks'
import { QRCode } from './QRCode'
import { CRYPTO_COINS, type CryptoCoin, type CryptoNetwork } from '../lib/donate'
import { useT } from '../lib/i18n'

/**
 * The crypto window's state: the picked coin and chain, Escape, focus and the
 * copied label. GlimStone's dialog owns the markup and is handed the QR encoder
 * and the coin marks, since the language ships neither.
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

  // The copy label flips for a moment and goes back, like every copy control
  // in the app.
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
        appeal: t('about.donateAppeal'),
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
