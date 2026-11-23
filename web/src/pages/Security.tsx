import type { SignInTileCard } from '@glimstone/core'
import { IDENTITY_PROVIDERS } from '@glimstone/core/identityProviders'
import { Card } from '@glimstone/react/Card'
import { SignInTile } from '@glimstone/react/SignInTile'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { arrivalCode, dropArrival, signIn } from '../lib/signIn'
import { tileText } from '../lib/signInWords'
import { useToast } from '../lib/toast'

// One account with one role, so the accounts card stays out.
const CARDS: SignInTileCard[] = ['password', 'askPassword', 'twoFactor', 'passkeys', 'sessions', 'tokens', 'services']

// Keys the glyph rules know, by what each of the tile's buttons does.
const LABEL_KEYS = {
  change: 'signIn.edit',
  setPassword: 'password.saveFirst',
  removePassword: 'password.remove',
  savePassword: 'password.saveFirst',
  setUp: 'signIn.setUp',
  newCodes: 'signIn.newCodes',
  turnOff: 'signIn.turnOff',
  copy: 'signIn.copy',
  confirm: 'signIn.confirm',
  add: 'signIn.add',
  rename: 'signIn.edit',
  remove: 'signIn.remove',
  end: 'signIn.end',
  endOthers: 'signIn.end',
  createToken: 'signIn.add',
  revoke: 'signIn.revoke',
  addService: 'signIn.add',
  test: 'signIn.test',
  edit: 'signIn.edit',
  turnOn: 'signIn.service',
  save: 'signIn.save',
  block: 'signIn.turnOff',
  unblock: 'signIn.setUp',
  passkey: 'signIn.passkey',
  token: 'signIn.token',
  account: 'signIn.account',
  laptop: 'deviceLaptop',
  phone: 'devicePhone',
  service: 'signIn.service',
  forward: 'signIn.forward',
}

/**
 * The ways in, as GlimStone's sign-in tile draws them on the kit's sign-in.
 * While ARROWLOOP_PASSWORD_HASH sets the password, the interface neither
 * changes nor removes it, so its card says where it comes from instead.
 */
export function Security() {
  const { t, lang } = useT()
  const push = useToast()
  const text = useMemo(() => tileText(t, lang), [t, lang])
  const [fromEnv, setFromEnv] = useState<boolean | null>(null)
  // What a test sign-in came back with, which lands on this tile.
  const [arrived] = useState(arrivalCode)

  useEffect(dropArrival, [])
  useEffect(() => {
    api.capabilities().then(
      (can) => setFromEnv(can.passwordFromEnv === true),
      () => setFromEnv(false),
    )
  }, [])

  if (fromEnv === null) return null
  return (
    <div className="glim-signin-tile" data-new="login-reset">
      {fromEnv && (
        <Card title={text.password.title} hueIndex={0} data-signin-card="password">
          <p className="glim-signin-tile-text">{t('password.env')}</p>
        </Card>
      )}
      <div data-new="sign-in">
        <SignInTile
          api={signIn}
          text={text}
          lang={lang}
          providers={IDENTITY_PROVIDERS}
          cards={fromEnv ? CARDS.filter((c) => c !== 'password') : CARDS}
          scopes={['read', 'all']}
          notify={push}
          arrived={arrived}
          labelKeys={LABEL_KEYS}
          hueStart={fromEnv ? 1 : 0}
        />
      </div>
    </div>
  )
}
