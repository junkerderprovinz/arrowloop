import { useState } from 'react'

import { Card } from '../lib/glimstone/Card'
import { Button } from '../lib/glimstone/Button'
import { Field, Secret } from '../components/Field'
import { IconConfirm } from '../components/glyphs'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * The password box, drawn only when the server's open probe route says one is
 * required. The browser's own credential dialogue cannot be styled, translated
 * or logged out of, so the server sends no WWW-Authenticate header.
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
      // Dropped once spent, so it cannot end up in a crash report.
      setPassword('')
      onIn()
    } catch (e) {
      const message = (e as Error).message
      // A 429 means wait rather than type it again.
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
                labelKey="login.submit"
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
