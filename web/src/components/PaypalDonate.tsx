import { useEffect, useRef, useState } from 'react'

import { PaypalDialog } from '../lib/glimstone/PaypalDialog'
import { usePaypalButtons } from '../lib/glimstone/usePaypalButtons'
import { Selector } from './Selector'
import { PAYPAL_GIVING } from '../lib/donate'
import { parseAmount, type GiveFrequency } from '../lib/paypal'
import { useT } from '../lib/i18n'

const AMOUNTS = ['10', '25', '50']

/** What the donor's PayPal history calls the payment. */
const DESCRIPTION = 'ArrowLoop'

/**
 * The PayPal window's state: how often, the picked or typed amount, Escape and
 * focus. GlimStone's dialog owns the markup and takes this app's Selector for
 * both rows.
 */
export function PaypalDonate({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  const [frequency, setFrequency] = useState<GiveFrequency>('once')
  const [preset, setPreset] = useState('25')
  const [typed, setTyped] = useState('')
  const [status, setStatus] = useState<'idle' | 'done' | 'failed'>('idle')
  const cardRef = useRef<HTMLDivElement>(null)

  // Anything in the field replaces the presets; an empty field hands the
  // amount back to them.
  const typing = typed.trim() !== ''
  const amount = typing ? parseAmount(typed) : preset

  const buttonsRef = usePaypalButtons({
    config: PAYPAL_GIVING,
    frequency,
    amount,
    description: DESCRIPTION,
    onDone: () => setStatus('done'),
    onError: () => setStatus('failed'),
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    cardRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <PaypalDialog
      text={{
        title: 'PayPal',
        appeal: t('about.donateAppeal'),
        intro: t('about.paypalIntro'),
        frequencyLabel: t('about.paypalFrequency'),
        frequencies: {
          once: t('about.paypalOnce'),
          month: t('about.paypalMonthly'),
          year: t('about.paypalYearly'),
        },
        amountLabel: t('about.paypalAmount'),
        otherAmount: t('about.paypalOther'),
        loading: t('about.paypalLoading'),
        thanks: t('about.paypalThanks'),
        failed: t('about.paypalFailed'),
        closeLabel: t('common.close'),
      }}
      frequency={frequency}
      onFrequency={(next) => {
        setFrequency(next)
        setStatus('idle')
      }}
      amounts={AMOUNTS}
      currencySymbol="€"
      preset={typing ? null : preset}
      onPreset={(next) => {
        setPreset(next)
        setTyped('')
      }}
      typed={typed}
      typedValid={typing && amount !== null}
      onTyped={setTyped}
      renderSelector={({ labelledBy, options, value, onChange }) => (
        <Selector
          scale="small"
          labelledBy={labelledBy}
          options={options}
          value={value ?? ''}
          onChange={onChange}
          // The amounts continue the palette where the frequencies above end,
          // so the two strips do not repeat each other's colours.
          hueOffset={labelledBy === 'paypal-amount' ? 3 : 0}
        />
      )}
      buttonsRef={buttonsRef}
      status={status}
      onClose={onClose}
      ref={cardRef}
    />
  )
}
