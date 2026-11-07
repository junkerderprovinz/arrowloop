import { useEffect, useState } from 'react'

import { Button } from '../lib/glimstone/Button'
import { SignInCard, type ResetAnswer, type SignInAnswer, type SignInText } from '../lib/glimstone/SignInCard'
import { LOGO_GOLD, LogoMark } from '../components/LogoMark'
import { IconConfirm } from '../components/glyphs'
import { ApiError, api, passkeysAvailableInBrowser, type ResetRemoved } from '../lib/api'
import { useT } from '../lib/i18n'
import { followDevice, storedTheme } from '../lib/themeSetting'

/**
 * The password box, drawn only when the server's open probe route says one is
 * required. The browser's own credential dialogue cannot be styled, translated
 * or logged out of, so the server sends no WWW-Authenticate header.
 *
 * With a second factor on, the server answers a right password with needCode
 * and the code field appears, the password kept. The field waits for that
 * answer, so nobody spends a thirty-second code on a mistyped password.
 */
export function Login({ onIn, canReset = false }: { onIn: () => void; canReset?: boolean }) {
  const { t } = useT()
  const [reset, setReset] = useState<{ minutes: number; minLength: number } | null>(null)
  const [removed, setRemoved] = useState<ResetRemoved | null>(null)

  // App repaints on a switch of the system's look, and it is not mounted yet.
  useEffect(() => followDevice(storedTheme()), [])

  // A prompt that cannot succeed is worse than no button, so the passkey is
  // offered only where the browser, the address and a registered key allow it.
  const [passkeyOffer, setPasskeyOffer] = useState(false)
  useEffect(() => {
    if (!passkeysAvailableInBrowser()) return
    let live = true
    api
      .passkeys()
      .then((s) => {
        if (live) setPasskeyOffer(s.supported && s.here > 0)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const locked = (e: unknown) => e instanceof ApiError && e.status === 429

  async function signIn({ password, code }: { password: string; code?: string }): Promise<SignInAnswer> {
    try {
      const res = await api.login(password, code)
      if (res.needCode) return { needCode: true }
      onIn()
      return { ok: true }
    } catch (e) {
      // A 429 means wait rather than type it again.
      if (locked(e)) return { needCode: code !== undefined, error: t('login.locked') }
      return code !== undefined ? { needCode: true } : { error: t('login.wrong') }
    }
  }

  async function withPasskey(): Promise<SignInAnswer> {
    try {
      await api.loginWithPasskey()
      onIn()
      return { ok: true }
    } catch (e) {
      if (locked(e)) return { error: t('login.locked') }
      if (e instanceof ApiError) return { error: t('login.passkeyFailed') }
      // A cancelled prompt lands here too, and its own words say more.
      return { error: e instanceof Error && e.message ? e.message : t('login.passkeyFailed') }
    }
  }

  // The form appears only once the code is in the log, so it never asks for
  // a code that does not exist.
  async function askCode(): Promise<ResetAnswer> {
    try {
      const res = await api.resetBegin()
      setReset({ minutes: res.minutes, minLength: res.minPasswordLen })
      return { ok: true }
    } catch (e) {
      return { error: locked(e) ? t('login.locked') : (e as Error).message || undefined }
    }
  }

  async function setPassword({ code, password }: { code: string; password: string }): Promise<ResetAnswer> {
    try {
      const res = await api.resetFinish(code, password)
      setRemoved(res.removed)
      return { ok: true }
    } catch (e) {
      return locked(e) ? { error: t('login.locked') } : { rejected: true }
    }
  }

  const minLength = reset?.minLength ?? 12
  const text: SignInText = {
    password: t('login.password'),
    signIn: t('login.submit'),
    signingIn: t('login.busy'),
    passkey: t('login.passkeyUnlock'),
    forgot: t('reset.link'),
    code: t('login.code'),
    codeHint: t('login.codeHint'),
    codeInvalid: t('twoFactor.codeInvalid'),
    back: t('preview.back'),
    resetCode: t('reset.code'),
    resetCodeTip: t('reset.codeTip', { minutes: reset?.minutes ?? 10 }),
    newPassword: t('password.new'),
    confirmPassword: t('password.repeat'),
    setPassword: t('password.saveFirst'),
    saving: t('reset.saving'),
    mismatch: t('password.mismatch'),
    tooShort: t('password.minLength', { count: minLength }),
    resetRejected: t('reset.invalid'),
    failed: t('login.failed'),
    show: t('secret.show'),
    hide: t('secret.hide'),
  }

  return (
    <SignInCard
      logo={<LogoMark size={64} style={{ color: LOGO_GOLD }} />}
      appName="ArrowLoop"
      text={text}
      passkey={passkeyOffer}
      reset={canReset}
      minPassword={minLength}
      idPrefix="login"
      labelKeys={{
        signIn: 'login.submit',
        passkey: 'login.passkeyUnlock',
        forgot: 'reset.link',
        back: 'preview.back',
        setPassword: 'password.saveFirst',
      }}
      className="min-h-[calc(100dvh-var(--window-bar))]"
      onSignIn={signIn}
      onPasskey={passkeyOffer ? withPasskey : undefined}
      onAskCode={canReset ? askCode : undefined}
      onSetPassword={canReset ? setPassword : undefined}
      step={removed && <ResetDone removed={removed} onDone={onIn} />}
    />
  )
}

/** Without this page the next sign-in looks for a passkey that is gone. */
function ResetDone({ removed, onDone }: { removed: ResetRemoved; onDone: () => void }) {
  const { t } = useT()
  return (
    <div className="glim-signin-form" role="status">
      <h2 className="text-body font-semibold text-carbon-text">{t('reset.doneTitle')}</h2>
      <div className="flex flex-col gap-1.5 text-body text-carbon-text">
        <p>{t('reset.doneIntro')}</p>
        <ul className="flex list-disc flex-col gap-1 ps-5">
          <li>{t('reset.doneSessions')}</li>
          {removed.secondFactor && <li>{t('reset.doneFactor')}</li>}
          {removed.passkeys > 0 && <li>{t('reset.donePasskeys', { count: removed.passkeys })}</li>}
        </ul>
      </div>
      {removed.passkeys > 0 && <p className="text-subline text-carbon-textSub">{t('reset.doneAddPasskeys')}</p>}
      <Button label={t('reset.done')} labelKey="reset.done" glyph={<IconConfirm />} tone="accent" onClick={onDone} />
    </div>
  )
}
