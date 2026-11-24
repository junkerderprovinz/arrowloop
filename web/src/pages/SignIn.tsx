import { signInCardHandlers, signInServiceLabel, type SignInCardService, type SignInOffer, type SignInRemoved } from '@glimstone/core'
import { IDENTITY_PROVIDERS } from '@glimstone/core/identityProviders'
import { SignInCard } from '@glimstone/react/SignInCard'
import { useEffect, useMemo, useState } from 'react'

import { LOGO_GOLD, LogoMark } from '../components/LogoMark'
import { IconConfirm } from '../components/glyphs'
import { Button } from '../lib/glimstone/Button'
import { useT } from '../lib/i18n'
import { signIn } from '../lib/signIn'
import { arrivedText, cardText, errorWords } from '../lib/signInWords'
import { followDevice, storedTheme } from '../lib/themeSetting'

const LABEL_KEYS = {
  signIn: 'login.submit',
  passkey: 'signIn.passkey',
  forgot: 'reset.link',
  back: 'preview.back',
  setPassword: 'password.saveFirst',
  service: 'signIn.service',
}

/**
 * The way in, GlimStone's sign-in card on the kit's sign-in. ArrowLoop has
 * one account, so the card asks for the password alone, and the sign-in
 * service that is on stands under Sign in. Passkeys come through the
 * browser's offer in the password field.
 *
 * Forgot password? stays away while ARROWLOOP_PASSWORD_HASH sets the
 * password, since no code from the log replaces that one.
 *
 * @param note    the line above the form, such as why the page came back.
 * @param arrived the code a sign-in service sent the browser back with.
 */
export function SignIn({
  offer,
  onIn,
  note,
  arrived,
}: {
  offer: SignInOffer & { pinned?: boolean }
  onIn: () => void
  note?: string
  arrived?: string | null
}) {
  const { t, lang } = useT()
  const [removed, setRemoved] = useState<SignInRemoved | null>(null)

  // App repaints on a switch of the system's look, and it is not mounted yet.
  useEffect(() => followDevice(storedTheme()), [])

  const handlers = useMemo(
    () =>
      signInCardHandlers(signIn, {
        words: { errors: errorWords(t), failed: t('login.failed') },
        onSignedIn: onIn,
        onReset: setRemoved,
      }),
    [t, onIn],
  )

  const first = offer.services[0]
  const service = useMemo<SignInCardService | undefined>(() => {
    if (!first) return undefined
    const { name, mark } = signInServiceLabel(first, IDENTITY_PROVIDERS, { services: { unnamed: t('signin.tile.services.unnamed') } })
    return mark ? { name, mark } : { name }
  }, [first, t])

  return (
    <SignInCard
      logo={<LogoMark size={64} style={{ color: LOGO_GOLD }} />}
      appName="ArrowLoop"
      text={cardText(t, lang)}
      reset={!offer.pinned}
      minPassword={offer.minPassword}
      note={note}
      error={arrived ? arrivedText(t, arrived) : undefined}
      service={service}
      onService={first ? () => window.location.assign(signIn.serviceAddress(first.id, window.location.pathname)) : undefined}
      labelKeys={LABEL_KEYS}
      idPrefix="login"
      className="min-h-[calc(100dvh-var(--window-bar))]"
      onSignIn={handlers.onSignIn}
      onPasskeyOffer={offer.passkeys ? handlers.onPasskeyOffer : undefined}
      onAskCode={handlers.onAskCode}
      onSetPassword={handlers.onSetPassword}
      step={removed && <ResetDone removed={removed} onDone={onIn} />}
    />
  )
}

/** What a reset took with it, so the next sign-in does not look for a passkey that is gone. */
function ResetDone({ removed, onDone }: { removed: SignInRemoved; onDone: () => void }) {
  const { t } = useT()
  return (
    <div className="glim-signin-form" role="status">
      <h2 className="text-body font-semibold text-carbon-text">{t('reset.doneTitle')}</h2>
      <div className="flex flex-col gap-1.5 text-body text-carbon-text">
        <p>{t('reset.doneIntro')}</p>
        <ul className="flex list-disc flex-col gap-1 ps-5">
          <li>{t('reset.doneSessions')}</li>
          {removed.twoFactor && <li>{t('reset.doneFactor')}</li>}
          {removed.passkeys > 0 && <li>{t('reset.donePasskeys', { count: removed.passkeys })}</li>}
          {removed.tokens > 0 && <li>{t('reset.doneTokens', { count: removed.tokens })}</li>}
          {removed.services > 0 && <li>{t('reset.doneServices')}</li>}
        </ul>
      </div>
      {removed.passkeys > 0 && <p className="text-subline text-carbon-textSub">{t('reset.doneAddPasskeys')}</p>}
      <Button label={t('reset.done')} labelKey="reset.done" glyph={<IconConfirm />} tone="accent" onClick={onDone} />
    </div>
  )
}
