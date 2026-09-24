import { useCallback, useEffect, useState } from 'react'

import { Card } from '../lib/glimstone/Card'
import { PasskeyCard } from '../components/PasskeyCard'
import { PasswordCard } from '../components/PasswordCard'
import { Stack } from '../components/Shell'
import { TwoFactorCard } from '../components/TwoFactorCard'
import { api, type SecurityStatus } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * The password, the second factor and the passkeys. Three cards, because they
 * are three decisions: whether there is a lock at all, whether the password
 * needs a code beside it, and whether a key may stand in for typing it.
 */
export function Security() {
  const { t } = useT()
  const [status, setStatus] = useState<SecurityStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    api
      .security()
      .then(setStatus)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(reload, [reload])

  if (status === null) {
    return (
      <Card title={t('settings.security')} hueIndex={0}>
        <p className="text-xs text-carbon-textMuted">{error ?? t('engine.loading')}</p>
      </Card>
    )
  }

  const passwordSet = status.password !== 'none'
  return (
    <Stack>
      <PasswordCard status={status} onChanged={setStatus} hueIndex={0} />
      {/* Keyed on the password, so a removed password also drops a setup
          that was half done under it. */}
      <TwoFactorCard
        key={String(passwordSet)}
        passwordSet={passwordSet}
        enabled={status.twoFactor}
        recoveryLeft={status.twoFactor ? status.recoveryCodesLeft : undefined}
        onChanged={reload}
        hueIndex={1}
      />
      <PasskeyCard passwordSet={passwordSet} hueIndex={2} />
    </Stack>
  )
}
