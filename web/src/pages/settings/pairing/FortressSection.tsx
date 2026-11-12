import { fill, fortressText, type ChangeAnswer, type FortressAnswer, type FortressText, type PhraseAnswer } from '@glimstone/core'
import { Fortress, FortressPairing } from '@glimstone/react/Fortress'
import { PasswordField } from '@glimstone/react/PasswordField'
import { Window } from '@glimstone/react/Window'
import { useMemo, useState } from 'react'

import { api, ApiError } from '../../../lib/api'
import { fortressApps, fortressPermissions, permissionOf, SELF, type FortressInfo } from '../../../lib/fortress'
import { useT } from '../../../lib/i18n'
import type { Translate } from '../../../lib/i18n.data'
import { refusalText, seenAgo } from '../../../lib/pairing'
import { useToast } from '../../../lib/toast'

// The keys ArrowLoop's own buttons use for the same acts, so that they wear
// the same glyphs.
const LABEL_KEYS = {
  join: 'pairing.join',
  leave: 'pairing.leave',
  showPhrase: 'pairing.show',
  changePhrase: 'fortress.changePhrase',
  remove: 'pairing.remove',
  unlock: 'pairing.show',
  copy: 'common.copy',
}

/** A refusal of the password, or of anything else, in the reader's words. */
function refused(t: Translate, text: FortressText, e: unknown): string {
  if (e instanceof ApiError && e.status === 403) return text.passwordWrong
  return refusalText(t, e)
}

/** Asks the engine for a new phrase and words its answer for GlimStone's flow. */
async function changePhrase(t: Translate, text: FortressText, password: string): Promise<ChangeAnswer & { wrong?: boolean }> {
  try {
    const r = await api.changeFortressPhrase(password)
    return { words: r.phrase.split(' '), left: r.left }
  } catch (e) {
    return { error: refused(t, text, e), wrong: e instanceof ApiError && e.status === 403 }
  }
}

/**
 * ArrowLoop's place in the fortress: GlimStone's fortress with the twelve
 * words to join, the phrase behind the password and the other apps with their
 * permissions, then the card where the phrase changes and ArrowLoop leaves.
 * The name the others know this instance by is the one the instance card sets.
 */
export function FortressSection({
  fortress,
  pairedWith,
  hueStart,
  onFortress,
  onRefresh,
}: {
  fortress: FortressInfo
  /** The instances whose pairing comes along on joining and ends on leaving. */
  pairedWith: string[]
  hueStart: number
  onFortress: (f: FortressInfo) => void
  /** Reads the group again, which joining and leaving change as well. */
  onRefresh: () => void
}) {
  const { t, lang } = useT()
  const push = useToast()
  // GlimStone words the fortress for an Instances tab. On this tile the
  // group's card has an Enter phrase too, so the fortress's says what it
  // joins, and the hints do not send anybody to Instances.
  const text = useMemo(() => {
    const own = fortressText(lang)
    return { ...own, enterPhrase: own.joinTitle, outHint: t('fortress.outBody'), phraseWhere: t('fortress.phraseWhere') }
  }, [lang, t])
  // The step that waits for the password before a new phrase is made.
  const [asking, setAsking] = useState<((answer: ChangeAnswer) => void) | null>(null)

  const apps = fortressApps(fortress.members, (unix) => seenAgo(lang, unix))

  const onJoin = async (words: string[]): Promise<FortressAnswer> => {
    try {
      onFortress(await api.joinFortress(words.join(' ')))
      onRefresh()
      return { ok: true }
    } catch (e) {
      return { error: e instanceof ApiError && e.code === 'inFortress' ? t('fortress.inFortress') : refusalText(t, e) }
    }
  }
  const onShowPhrase = async (password?: string): Promise<PhraseAnswer> => {
    try {
      return { words: (await api.showFortressPhrase(password ?? '')).phrase.split(' ') }
    } catch (e) {
      return { error: refused(t, text, e) }
    }
  }
  // The answer shows the new words, so they come only for the password, as
  // showing the phrase does. GlimStone's change window waits meanwhile.
  const onChangePhrase = (): Promise<ChangeAnswer> =>
    fortress.passwordSet ? new Promise((resolve) => setAsking(() => resolve)) : changePhrase(t, text, '')
  const onLeave = async (): Promise<FortressAnswer> => {
    try {
      onFortress(await api.leaveFortress())
      onRefresh()
      return { ok: true }
    } catch (e) {
      return { error: refusalText(t, e) }
    }
  }
  const onPermission = async (id: string, on: boolean): Promise<FortressAnswer> => {
    try {
      onFortress(await api.setFortressPermission(permissionOf(id, on)))
      return { ok: true }
    } catch (e) {
      return { error: refusalText(t, e) }
    }
  }

  return (
    <div id="fortress" className="flex scroll-mt-6 flex-col gap-10">
      <Fortress
        text={text}
        lang={lang}
        app={SELF}
        joined={fortress.joined}
        apps={apps}
        permissions={fortressPermissions(fortress.permissions, fortress.members, t)}
        onPermission={onPermission}
        notify={push}
        onJoin={onJoin}
        onRemove={() => Promise.resolve({ error: text.failed })}
        onShowPhrase={fortress.phrase ? onShowPhrase : undefined}
        phrasePassword={fortress.passwordSet}
        pairedWith={pairedWith}
        labelKeys={LABEL_KEYS}
        hueStart={hueStart}
      />
      {fortress.joined && (
        <FortressPairing
          text={{ ...text, pairing: t('fortress.title') }}
          lang={lang}
          app={SELF}
          onLeave={onLeave}
          onChangePhrase={fortress.phrase ? onChangePhrase : undefined}
          pairedWith={pairedWith}
          labelKeys={LABEL_KEYS}
          hueIndex={hueStart + apps.length + 2}
        />
      )}
      {asking && (
        <ChangePassword
          text={text}
          onAnswer={(answer) => {
            setAsking(null)
            asking(answer)
          }}
        />
      )}
    </div>
  )
}

/**
 * Asks for the login password in front of a phrase change. A wrong one keeps
 * it open, and closing it keeps the phrase.
 */
function ChangePassword({ text, onAnswer }: { text: FortressText; onAnswer: (answer: ChangeAnswer) => void }) {
  const { t } = useT()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    if (busy || password === '') return
    setBusy(true)
    const answer = await changePhrase(t, text, password)
    setBusy(false)
    if (answer.wrong) {
      setError(answer.error ?? text.passwordWrong)
      return
    }
    onAnswer(answer)
  }

  return (
    <Window
      title={text.phraseTitle}
      text={{ cancel: text.cancel, close: text.close }}
      onClose={() => onAnswer({ error: t('fortress.changeKept') })}
      actions={[
        {
          label: text.changeConfirm,
          labelKey: LABEL_KEYS.changePhrase,
          primary: true,
          disabled: busy || password === '',
          attrs: { 'data-fortress': 'change-unlock' },
          onClick: () => {
            void send()
            return false
          },
        },
      ]}
    >
      <form
        className="glim-fortress-text"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <p>{fill(text.phrasePassword, { app: SELF.name })}</p>
        <PasswordField
          aria-label={fill(text.password, { app: SELF.name })}
          placeholder={fill(text.password, { app: SELF.name })}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          text={{ show: text.showPassword, hide: text.hidePassword }}
          autoFocus
        />
        {error && (
          <p className="glim-fortress-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Window>
  )
}
