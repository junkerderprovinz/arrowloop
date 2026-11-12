import { fill, fortressText, type ChangeAnswer, type FortressAnswer, type FortressText, type PhraseAnswer } from '@glimstone/core'
import { Fortress, FortressPairing } from '@glimstone/react/Fortress'
import { PasswordField } from '@glimstone/react/PasswordField'
import { Window } from '@glimstone/react/Window'
import { useMemo, useRef, useState } from 'react'

import { api, ApiError, type Phrase } from '../../../lib/api'
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

/** A new phrase in GlimStone's words, with the text of its QR code beside them. */
type NewPhrase = ChangeAnswer & { code?: string; wrong?: boolean }

/** Asks the engine for a new phrase and words its answer for GlimStone's flow. */
async function changePhrase(t: Translate, text: FortressText, password: string): Promise<NewPhrase> {
  try {
    const r = await api.changeFortressPhrase(password)
    return { words: r.phrase.split(' '), left: r.left, code: r.code }
  } catch (e) {
    return { error: refused(t, text, e), wrong: e instanceof ApiError && e.status === 403 }
  }
}

/**
 * ArrowLoop's place in the fortress. Inside one, the Fortress card comes
 * first, the one place where the phrase shows behind the password and
 * changes, and where ArrowLoop leaves. The other apps with their permissions
 * follow. Outside, the twelve words join one. The name the others know this
 * instance by is the one the instance card sets.
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
  // joins, and the hints do not send anybody to Instances. GlimStone's change
  // texts tell members out of reach that they need the new phrase, but the
  // kit lets them follow on the old one for 30 days.
  const text = useMemo(() => {
    const own = fortressText(lang)
    return {
      ...own,
      enterPhrase: own.joinTitle,
      outHint: t('fortress.outBody'),
      phraseWhere: t('fortress.phraseWhere'),
      changePhraseAbout: t('fortress.changePhraseAbout'),
      changeBody: t('fortress.changeBody'),
      changeAway: t('fortress.changeAway'),
      changedLeft: t('fortress.changedLeft'),
    }
  }, [lang, t])
  // The step that waits for the password before a new phrase is made.
  const [asking, setAsking] = useState<((answer: NewPhrase) => void) | null>(null)
  // The engine writes the QR code's text, which names an own relay that the
  // phone app has no other way to learn. GlimStone asks for it by the words.
  const shown = useRef<Phrase | null>(null)
  const keep = <A extends { words?: string[]; code?: string }>(answer: A): A => {
    if (answer.words && answer.code) shown.current = { phrase: answer.words.join(' '), code: answer.code }
    return answer
  }
  const phraseQr = (words: string[]) => {
    const phrase = words.join(' ')
    return shown.current?.phrase === phrase ? shown.current.code : phrase
  }

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
      const r = await api.showFortressPhrase(password ?? '')
      return keep({ words: r.phrase.split(' '), code: r.code })
    } catch (e) {
      return { error: refused(t, text, e) }
    }
  }
  // The answer shows the new words, so they come only for the password, as
  // showing the phrase does. GlimStone's change window waits meanwhile.
  const onChangePhrase = (): Promise<ChangeAnswer> =>
    (fortress.passwordSet ? new Promise<NewPhrase>((resolve) => setAsking(() => resolve)) : changePhrase(t, text, '')).then(keep)
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
      {fortress.joined && (
        <FortressPairing
          text={{ ...text, pairing: t('fortress.title') }}
          lang={lang}
          app={SELF}
          onShowPhrase={fortress.phrase ? onShowPhrase : undefined}
          phrasePassword={fortress.passwordSet}
          phraseQr={phraseQr}
          onChangePhrase={fortress.phrase ? onChangePhrase : undefined}
          onLeave={onLeave}
          pairedWith={pairedWith}
          labelKeys={LABEL_KEYS}
          hueIndex={hueStart}
        />
      )}
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
        pairedWith={pairedWith}
        labelKeys={LABEL_KEYS}
        hueStart={hueStart + 1}
      />
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
function ChangePassword({ text, onAnswer }: { text: FortressText; onAnswer: (answer: NewPhrase) => void }) {
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
