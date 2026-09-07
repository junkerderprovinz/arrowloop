import { useState } from 'react'

import { Card } from '../lib/glimstone/Card'
import { Button } from '../lib/glimstone/Button'
import { Field, Secret } from '../components/Field'
import { IconConfirm } from '../components/glyphs'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * The password box, drawn only when there is a password to give.
 *
 * The interface asks the server whether one is required before it draws
 * anything, which is why there is a probe route open to everybody. Working it
 * out from a 401 instead would mean every page load starting with a failed
 * request, and the interface guessing at the difference between "you are logged
 * out" and "there is no login here".
 *
 * Deliberately NOT the browser's own credential dialogue. That box cannot be
 * styled, cannot be translated, and has no way to log out again short of closing
 * the browser, which is why the server sends no WWW-Authenticate header.
 */
export function Login({ onIn }: { onIn: () => void }) {
  const { t } = useT()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await api.login(password)
      // The password is dropped the moment it has been spent. It is not needed
      // again, and a component that keeps holding it is one more place it can
      // end up in a crash report.
      setPassword('')
      onIn()
    } catch (e) {
      const message = (e as Error).message
      // The server answers 429 with its own words when somebody has tried too
      // often. Told apart here because the two need different reactions: one
      // means type it again, the other means stop and wait.
      setError(message.includes('429') || /too many/i.test(message) ? t('login.locked') : t('login.wrong'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-carbon-background p-6">
      <div className="w-full max-w-sm">
        <Card title={t('login.title')} hueIndex={0}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              // A real form, so Enter submits. A password box that only answers
              // a mouse click is the one control everybody tries to use with the
              // keyboard.
              e.preventDefault()
              void submit()
            }}
          >
            <Field label={t('login.password')}>
              <Secret value={password} onChange={setPassword} />
            </Field>
            {error && <p className="text-xs text-statusFail">{error}</p>}
            <div className="flex justify-end">
              <Button
                label={t('login.submit')}
                labelKey={null}
                glyph={<IconConfirm />}
                tone="accent"
                type="submit"
                busy={busy}
                disabled={busy || password === ''}
                onClick={() => void submit()}
              />
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}
