import {
  createFortressFlow,
  fill,
  fortressText,
  joinRefusalText,
  openRefusalText,
  phraseReady,
  type ChangeAnswer,
  type FortressAnswer,
  type FortressApp,
  type FortressInstance,
  type FortressText,
  type PhraseAnswer,
} from '@glimstone/core'
import { Button } from '@glimstone/react/Button'
import { Fortress, FortressPairing } from '@glimstone/react/Fortress'
import { FortressStatusWindow } from '@glimstone/react/FortressStatusWindow'
import { glyphFor } from '@glimstone/react/glyphs'
import { Window } from '@glimstone/react/Window'
import { useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { api, ApiError, type Phrase } from '../../../lib/api'
import { at } from '../../../lib/base'
import { dayTime } from '../../../lib/dayTime'
import { inDesktopWindow } from '../../../lib/desk'
import { fortressApps, fortressPermissions, leftNames, permissionOf, SELF, statusLines, type FortressInfo, type MemberStatus } from '../../../lib/fortress'
import { useT } from '../../../lib/i18n'
import type { Translate } from '../../../lib/i18n.data'
import { refusalText, seenAgo } from '../../../lib/pairing'
import { wantsSignIn, withPassword } from '../../../lib/signIn'
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

/** The code a refusal came with, for openRefusalText. */
const refusalCode = (e: unknown) => (e instanceof ApiError ? (e.code ?? '') : '')

/** A member Open shows as a window: its report once it came, or why it did not. */
type Shown = { app: FortressApp; instance: FortressInstance; got?: MemberStatus; error?: string }

/** A new phrase in GlimStone's words, with the text of its QR code beside them. */
type NewPhrase = ChangeAnswer & { code?: string }

/**
 * Asks the engine for a new phrase and words its answer for GlimStone's flow.
 * The password question comes first where the last sign-in is a while ago,
 * and closing it keeps the phrase.
 */
async function changePhrase(t: Translate, text: FortressText): Promise<NewPhrase> {
  try {
    const r = await withPassword(() => api.changeFortressPhrase())
    const left = leftNames(r.left ?? [], (app, device) => fill(text.memberOn, { app, device }))
    return { words: r.phrase.split(' '), left, code: r.code }
  } catch (e) {
    return { error: wantsSignIn(e) ? t('fortress.changeKept') : refusalText(t, e) }
  }
}

/**
 * ArrowLoop's place in the fortress. Inside one, the Fortress card comes
 * first, the one place where the phrase shows behind a fresh sign-in and
 * changes, and where ArrowLoop leaves. Once a member says the phrase changed
 * and nobody in reach hands the new one over, it asks for the new words. The
 * other apps with their permissions follow. Outside, the twelve words join
 * one. The name the others know this
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
  const { t, lang, locale } = useT()
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

  // A member with pages opens them in a tab through the fortress, which needs
  // this browser's password session; the desktop window has none to hand the
  // tab. Any other member, such as a plugin whose pages live in Unraid, shows
  // its report in a window.
  const [status, setStatus] = useState<Shown | null>(null)
  const showStatus = (app: FortressApp, instance: FortressInstance) => {
    setStatus({ app, instance })
    const when = (iso: string) => dayTime(iso, locale, (p) => t('list.when', p))
    const keep = (change: Partial<Shown>) => setStatus((s) => (s?.instance.id === instance.id ? { ...s, ...change } : s))
    api.fortressMemberStatus(instance.id, lang).then(
      (got) => keep({ got: statusLines(got, when) }),
      (e) => keep({ error: openRefusalText(text, refusalCode(e)) }),
    )
  }
  const onOpen = (app: FortressApp, instance: FortressInstance) => {
    const member = fortress.members.find((m) => m.id === instance.id)
    if (!member?.pages || inDesktopWindow()) {
      showStatus(app, instance)
      return
    }
    // Asked at once, since the browser lets a tab open only shortly after the click.
    api.openFortressMember(instance.id).then(
      ({ path }) => {
        window.open(at(path), '_blank', 'noopener')
      },
      (e) => push(openRefusalText(text, refusalCode(e)), 'fail'),
    )
  }

  const onJoin = async (words: string[]): Promise<FortressAnswer> => {
    try {
      onFortress(await api.joinFortress(words.join(' ')))
      onRefresh()
      return { ok: true }
    } catch (e) {
      // GlimStone words the kit's own refusal itself.
      if (e instanceof ApiError && e.code === 'closedUntilNewPhrase') return { code: e.code }
      return { error: e instanceof ApiError && e.code === 'inFortress' ? t('fortress.inFortress') : refusalText(t, e) }
    }
  }
  // GlimStone asks for no password of its own: the engine wants a fresh
  // sign-in, and the password question stands in for it.
  const onShowPhrase = async (): Promise<PhraseAnswer> => {
    try {
      const r = await withPassword(() => api.showFortressPhrase())
      return keep({ words: r.phrase.split(' '), code: r.code })
    } catch (e) {
      return { error: wantsSignIn(e) ? t('signin.error.signInAgain') : refusalText(t, e) }
    }
  }
  // The answer shows the new words, so they want a fresh sign-in as showing
  // the phrase does. The Fortress card offers it, and the fortress again right
  // after a removal.
  const onChangePhrase = (): Promise<ChangeAnswer> =>
    changePhrase(t, text).then((answer) => {
      if (answer.words) onRefresh()
      return keep(answer)
    })
  const onLeave = async (): Promise<FortressAnswer> => {
    try {
      onFortress(await api.leaveFortress())
      onRefresh()
      return { ok: true }
    } catch (e) {
      return { error: refusalText(t, e) }
    }
  }
  const onRemove = async (id: string): Promise<FortressAnswer> => {
    try {
      onFortress(await api.removeFortressMember(id))
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
          phrasePassword={false}
          phraseQr={phraseQr}
          onChangePhrase={fortress.phrase ? onChangePhrase : undefined}
          onLeave={onLeave}
          pairedWith={pairedWith}
          labelKeys={LABEL_KEYS}
          hueIndex={hueStart}
        >
          {fortress.phraseChanged && <NewWords text={text} onJoin={onJoin} />}
        </FortressPairing>
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
        onRemove={onRemove}
        onChangePhrase={fortress.phrase ? onChangePhrase : undefined}
        removed={fortress.removed.map((r) => fill(text.memberOn, { app: r.name, device: r.device }))}
        removedHere={fortress.removedHere}
        onOpen={onOpen}
        pairedWith={pairedWith}
        labelKeys={LABEL_KEYS}
        hueStart={hueStart + 1}
      />
      {status && (
        <FortressStatusWindow
          app={status.app}
          instance={status.instance}
          report={status.got?.report}
          log={status.got?.log}
          loading={!status.got && !status.error}
          error={status.error}
          text={text}
          lang={lang}
          onClose={() => setStatus(null)}
        />
      )}
    </div>
  )
}

/**
 * Says on the Fortress card that the fortress has a new phrase ArrowLoop
 * could not follow on its own, and takes its words. With them ArrowLoop stays
 * the member it was.
 */
function NewWords({ text, onJoin }: { text: FortressText; onJoin: (words: string[]) => Promise<FortressAnswer> }) {
  const latest = useRef({ text, onJoin })
  latest.current = { text, onJoin }
  const flow = useMemo(
    () =>
      createFortressFlow(() => ({
        onJoin: latest.current.onJoin,
        failed: latest.current.text.failed,
        joinRefusal: (code) => joinRefusalText(latest.current.text, code),
      })),
    [],
  )
  const s = useSyncExternalStore(flow.subscribe, flow.state, flow.state)
  const w = s.window?.kind === 'join' ? s.window : null

  return (
    <>
      <div className="glim-fortress-removed" data-fortress="moved" role="status">
        {glyphFor('info')}
        <span>
          <strong>{text.changedTitle}</strong> {fill(text.phraseMoved, { app: SELF.name })}
        </span>
        <Button label={text.enterPhrase} labelKey={LABEL_KEYS.join} tone="subtle" onClick={flow.openJoin} data-fortress="open-new-words" />
      </div>
      {w && (
        <Window
          title={text.changedTitle}
          size="wide"
          text={{ cancel: text.cancel, close: text.close }}
          onClose={flow.close}
          actions={[
            {
              label: text.join,
              labelKey: LABEL_KEYS.join,
              primary: true,
              disabled: s.busy === 'join' || !phraseReady(w.words),
              attrs: { 'data-fortress': 'join' },
              onClick: () => {
                void flow.join()
                return false
              },
            },
          ]}
        >
          <form
            className="glim-fortress-text"
            onSubmit={(e) => {
              e.preventDefault()
              void flow.join()
            }}
          >
            <p>{fill(text.phraseMoved, { app: SELF.name })}</p>
            <div className="glim-phrase-fields">
              {w.words.map((word, i) => (
                <label key={i} className="glim-phrase-field">
                  <span className="glim-phrase-number glim-num">{i + 1}</span>
                  <input
                    className="glim-input"
                    data-word={i}
                    value={word}
                    aria-label={fill(text.word, { n: i + 1 })}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => flow.enter(i, e.target.value)}
                  />
                </label>
              ))}
            </div>
            <button type="submit" hidden />
            <p className="glim-fortress-sub">{text.phraseWhere}</p>
            {s.error && (
              <p className="glim-fortress-error" role="alert">
                {s.error}
              </p>
            )}
          </form>
        </Window>
      )}
    </>
  )
}
