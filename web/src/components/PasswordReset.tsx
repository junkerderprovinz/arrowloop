import { useState } from 'react'

import { Card } from '../lib/glimstone/Card'
import { Button } from '../lib/glimstone/Button'
import { CONTROL_H, Field, Secret } from './Field'
import { IconConfirm } from './glyphs'
import { ApiError, api, type ResetRemoved } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * A forgotten password, reset with the code the server has just written to its
 * own log. Reading that log is what proves the owner, so the code is never
 * shown here. The caller asks for the code first, so this form never asks for
 * one that does not exist.
 */
export function PasswordReset({
  minutes,
  minLength,
  onDone,
  onBack,
}: {
  minutes: number
  minLength: number
  /** The answer to the reset already carries the session. */
  onDone: () => void
  onBack: () => void
}) {
  const { t } = useT()
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [removed, setRemoved] = useState<ResetRemoved | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function finish() {
    // Caught here, so a typing mistake never costs a guess at the code.
    if ([...password].length < minLength) {
      setError(t('password.minLength', { count: minLength }))
      return
    }
    if (password !== confirm) {
      setError(t('password.mismatch'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.resetFinish(code, password)
      setPassword('')
      setConfirm('')
      setRemoved(res.removed)
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setError(t('login.locked'))
      } else {
        // The answer does not say whether the code expired, and the sentence
        // promises a new one for that case. Asking writes one only when none
        // is live.
        await api.resetBegin().catch(() => undefined)
        setError(t('reset.invalid'))
      }
    } finally {
      setBusy(false)
    }
  }

  if (removed) {
    // Without this page the next sign-in looks for a passkey that is gone.
    return (
      <Card title={t('reset.doneTitle')} hueIndex={0}>
        <div className="flex flex-col gap-4" role="status">
          <div className="flex flex-col gap-1.5 text-body text-carbon-text">
            <p>{t('reset.doneIntro')}</p>
            <ul className="flex list-disc flex-col gap-1 ps-5">
              <li>{t('reset.doneSessions')}</li>
              {removed.secondFactor && <li>{t('reset.doneFactor')}</li>}
              {removed.passkeys > 0 && <li>{t('reset.donePasskeys', { count: removed.passkeys })}</li>}
            </ul>
          </div>
          {removed.passkeys > 0 && <p className="text-subline text-carbon-textSub">{t('reset.doneAddPasskeys')}</p>}
          <Button
            label={t('reset.done')}
            labelKey="reset.done"
            glyph={<IconConfirm />}
            tone="accent"
            className="w-full"
            onClick={onDone}
          />
        </div>
      </Card>
    )
  }

  return (
    <Card title={t('reset.title')} hueIndex={0}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) void finish()
        }}
      >
        <Field label={t('reset.code')} hint={t('reset.codeTip', { minutes })}>
          {/* The server takes it in either case, with or without dashes and
              spaces, since people copy it off the log in every shape. */}
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX"
            className={`w-full ${CONTROL_H} bg-carbon-surface2 px-3 font-mono text-meta uppercase tracking-[0.2em] text-carbon-text outline-none transition placeholder:tracking-[0.2em] placeholder:text-carbon-textMuted focus:brightness-125`}
            style={{ borderRadius: 'var(--radius-control)' }}
          />
        </Field>
        <Field label={t('password.new')} hint={t('password.minLength', { count: minLength })}>
          <Secret value={password} onChange={setPassword} autoComplete="new-password" />
        </Field>
        <Field label={t('password.repeat')}>
          <Secret value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </Field>

        {/* Cleared at every attempt, so each refusal mounts it and shakes. */}
        {error && (
          <p className="glim-shake text-subline text-statusFail" role="alert">
            {error}
          </p>
        )}

        {/* Stacked, because the longer translations of the two labels do not
            fit the card side by side. */}
        <Button
          label={t('password.saveFirst')}
          labelKey="password.saveFirst"
          tone="accent"
          type="submit"
          className="w-full"
          busy={busy}
          disabled={busy || code.trim() === '' || password === ''}
        />
        <Button
          label={t('preview.back')}
          labelKey="preview.back"
          tone="subtle"
          className="w-full"
          disabled={busy}
          onClick={onBack}
        />
      </form>
    </Card>
  )
}
