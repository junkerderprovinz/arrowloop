import { useEffect, useRef } from 'react'

import { CoffeeDialog } from '../lib/glimstone/CoffeeDialog'
import { COFFEE_WIDGET } from '../lib/donate'
import { useT } from '../lib/i18n'

/** The coffee window's Escape and focus, around GlimStone's dialog. */
export function CoffeeDonate({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    cardRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <CoffeeDialog
      widgetUrl={COFFEE_WIDGET}
      text={{
        title: 'Buy Me a Coffee',
        intro: t('about.coffeeIntro'),
        closeLabel: t('common.close'),
      }}
      onClose={onClose}
      ref={cardRef}
    />
  )
}
