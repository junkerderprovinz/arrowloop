import { useEffect, useState } from 'react'

import { Card } from '../lib/glimstone/Card'
import { Button } from '../lib/glimstone/Button'
import { Field, Secret, Text } from '../components/Field'
import { IconCheck } from '../components/glyphs'
import { ApiError, api, passkeysAvailableInBrowser } from '../lib/api'
import { useT } from '../lib/i18n'
import { PasswordReset } from '../components/PasswordReset'

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
  const [resetBusy, setResetBusy] = useState(false)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [needCode, setNeedCode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A prompt that cannot succeed is worse than no button, so the passkey is
  // offered only where the browser, the address and a registered key allow it.
  const [passkeyOffer, setPasskeyOffer] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)
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

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.login(password, needCode ? code : undefined)
      if (res.needCode) {
        setNeedCode(true)
        setCode('')
        return
      }
      // Dropped once spent, so it cannot end up in a crash report.
      setPassword('')
      setCode('')
      onIn()
    } catch (e) {
      // A 429 means wait rather than type it again.
      if (e instanceof ApiError && e.status === 429) setError(t('login.locked'))
      else setError(needCode ? t('twoFactor.codeInvalid') : t('login.wrong'))
      if (needCode) setCode('')
    } finally {
      setBusy(false)
    }
  }

  async function withPasskey() {
    setPasskeyBusy(true)
    setError(null)
    try {
      await api.loginWithPasskey()
      onIn()
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setError(t('login.locked'))
      else if (e instanceof ApiError) setError(t('login.passkeyFailed'))
      // A cancelled prompt lands here too, and its own words say more.
      else setError(e instanceof Error && e.message ? e.message : t('login.passkeyFailed'))
    } finally {
      setPasskeyBusy(false)
    }
  }

  // The form appears only once the code is in the log, so it never asks for
  // a code that does not exist.
  async function forgot() {
    setResetBusy(true)
    setError(null)
    try {
      const res = await api.resetBegin()
      setReset({ minutes: res.minutes, minLength: res.minPasswordLen })
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? t('login.locked') : (e as Error).message)
    } finally {
      setResetBusy(false)
    }
  }

  if (reset) {
    return (
      <div className="flex h-screen items-center justify-center bg-carbon-background p-6">
        <div className="w-full max-w-sm">
          <PasswordReset minutes={reset.minutes} minLength={reset.minLength} onDone={onIn} onBack={() => setReset(null)} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center bg-carbon-background p-6">
      <div className="w-full max-w-sm">
        <Card title={t('login.title')} hueIndex={0}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <Field label={t('login.password')}>
              <Secret value={password} onChange={setPassword} autoComplete="current-password" />
            </Field>
            {needCode && (
              <Field label={t('login.code')} hint={t('login.codeHint')}>
                <Text value={code} onChange={setCode} placeholder="000000" code mono />
              </Field>
            )}
            {/* Cleared at every attempt, so each refusal mounts it and shakes. */}
            {error && (
              <p className="glim-shake text-subline text-statusFail" role="alert">
                {error}
              </p>
            )}
            <Button
              label={t('login.submit')}
              labelKey="login.submit"
              glyph={<IconCheck />}
              tone="accent"
              type="submit"
              className="w-full"
              busy={busy}
              disabled={busy || password === '' || (needCode && code.trim() === '')}
            />
            {/* Under the password, which always works. Hidden rather than
                disabled where it cannot work: a disabled control on a login
                screen reads as being locked out. */}
            {passkeyOffer && !needCode && (
              <Button
                label={t('login.passkeyUnlock')}
                labelKey="login.passkeyUnlock"
                className="w-full"
                busy={passkeyBusy}
                disabled={busy || passkeyBusy}
                onClick={() => void withPasskey()}
              />
            )}
            {/* Only for a password set in the interface: one from the
                environment is changed where the container is set up. */}
            {canReset && (
              <Button
                label={t('reset.link')}
                labelKey="reset.link"
                tone="subtle"
                className="w-full"
                busy={resetBusy}
                disabled={busy || resetBusy}
                onClick={() => void forgot()}
              />
            )}
          </form>
        </Card>
      </div>
    </div>
  )
}
