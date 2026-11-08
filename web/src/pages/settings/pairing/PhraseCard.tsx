import { useEffect, useRef, useState, type ReactNode } from 'react'

import { ConfirmWindow } from '../../../components/ConfirmWindow'
import { Dialog } from '../../../components/Dialog'
import { FieldRow, Secret } from '../../../components/Field'
import { IconCheck, IconClose, IconCopy, IconEye, IconSignOut } from '../../../components/glyphs'
import { api, type ConnectInfo } from '../../../lib/api'
import { inDesktopWindow } from '../../../lib/desk'
import { Button } from '../../../lib/glimstone/Button'
import { Card } from '../../../lib/glimstone/Card'
import { useT } from '../../../lib/i18n'
import { refusalText, type PairStage } from '../../../lib/pairing'
import { navigate } from '../../../lib/router'
import { useToast } from '../../../lib/toast'
import { PhraseGlyph } from './pairingArt'
import { usePhraseEntry } from './PhraseEntry'
import { CardFoot } from './parts'
import { WordSlots } from './WordSlots'

/**
 * Where an instance joins a group. Outside one it offers two tiles: make a
 * phrase, or enter one that already exists, each opening a window. Inside one
 * it holds the way back to the words and out of the group. Who is in the
 * group stands in the card below it.
 */
export function PhraseCard({
  group,
  stage,
  hueIndex,
  onCreatedHere,
  onGroup,
  onRefresh,
}: {
  group: ConnectInfo
  stage: PairStage
  hueIndex: number
  /** Tells the page whether the group this instance is in was made here. */
  onCreatedHere: (made: boolean) => void
  onGroup: (g: ConnectInfo) => void
  onRefresh: () => void
}) {
  const { t } = useT()
  const push = useToast()
  const [phrase, setPhrase] = useState<{ phrase: string; code: string } | null>(null)
  // The window over the card: the words to read out, or the field for the words of a first instance.
  const [shown, setShown] = useState<'words' | 'enter' | null>(null)
  const [password, setPassword] = useState('')
  const [leaving, setLeaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)
  const [copied, setCopied] = useState(false)

  // Words shown here belong to the group they were shown for. Another tab can
  // leave it, and the poll is the only sign.
  const wasActive = useRef(group.active)
  useEffect(() => {
    if (wasActive.current && !group.active) forget()
    wasActive.current = group.active
  })

  function forget() {
    setPhrase(null)
    setCopied(false)
    onCreatedHere(false)
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch (e) {
      push(refusalText(t, e), 'fail')
      setShake((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    run(async () => {
      const made = await api.makePhrase()
      setPhrase({ phrase: made.phrase, code: made.code })
      onCreatedHere(true)
      onGroup(made.info)
      setShown('words')
    })

  const show = () =>
    run(async () => {
      setPhrase(await api.revealPhrase(password))
      setPassword('')
    })

  /** Takes this instance out of its group, then runs `then` to set up what the card shows next. */
  const leave = (then: () => void = () => {}) =>
    run(async () => {
      await api.leaveGroup()
      forget()
      then()
      onRefresh()
    })

  async function join(words: string): Promise<string | null> {
    setBusy(true)
    try {
      onGroup(await api.joinGroup(words))
      forget()
      setShown(null)
      push(t('pairing.joined'), 'success')
      return null
    } catch (e) {
      return refusalText(t, e)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!phrase) return
    await navigator.clipboard?.writeText(phrase.phrase)
    setCopied(true)
  }

  const openWords = () => {
    setShown('words')
    // Without a password there is nothing to enter before the words show.
    if (!phrase && !group.passwordSet) void show()
  }
  const close = () => {
    setShown(null)
    setPassword('')
  }

  // Pairing works without a password, but then whoever opens this page holds
  // the words and, through the group, every instance in it.
  const noPassword = !group.passwordSet && !inDesktopWindow() && (
    <section className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-control bg-statusWarnBgSoft p-4" data-testid="no-password">
      <span className="shrink-0 text-statusWarn">
        <PhraseGlyph kind="warn" size={22} />
      </span>
      <div className="min-w-0 flex-[1_1_18rem]">
        <p className="text-title font-semibold text-carbon-text">{t('pairing.noPasswordTitle')}</p>
        <p className="mt-0.5 text-body leading-relaxed text-carbon-text">{t('pairing.noPassword')}</p>
      </div>
      <Button
        label={t('password.saveFirst')}
        labelKey="password.saveFirst"
        tone="accent"
        onClick={() => navigate('/settings/security')}
      />
    </section>
  )

  let body: ReactNode
  let foot: ReactNode = null
  if (stage === 'unpaired') {
    body = (
      <>
        {noPassword}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Choice
            key={`create-${shake}`}
            glyph={<PhraseGlyph kind="create" size={22} />}
            title={t('pairing.create')}
            sub={t('pairing.createSub')}
            disabled={busy}
            shaking={shake > 0}
            onClick={() => void create()}
          />
          <Choice glyph={<PhraseGlyph kind="enter" size={22} />} title={t('pairing.enter')} sub={t('pairing.enterSub')} onClick={() => setShown('enter')} />
        </div>
      </>
    )
  } else {
    const lead = stage === 'alone' ? 'pairing.aloneLead' : stage === 'paired' ? 'pairing.pairedLead' : 'pairing.searchingLead'
    body = (
      <>
        {noPassword}
        {stage === 'new' ? (
          <>
            <div className="flex flex-wrap items-center justify-end gap-2 text-subline text-carbon-textMuted">
              {t('pairing.notFirst')}
              <Button
                label={t('pairing.enter')}
                labelKey="pairing.enter"
                glyph={<PhraseGlyph kind="enter" />}
                disabled={busy}
                onClick={() => void leave(() => setShown('enter'))}
              />
            </div>
            <NextStep />
          </>
        ) : (
          <p className="text-body text-carbon-textSub">{t(lead)}</p>
        )}
      </>
    )
    foot = (
      <>
        <Button label={t('pairing.show')} labelKey="pairing.show" glyph={<IconEye />} disabled={busy} onClick={openWords} />
        <Button label={t('pairing.leave')} labelKey="pairing.leave" glyph={<IconSignOut />} disabled={busy} onClick={() => setLeaving(true)} />
      </>
    )
  }

  const tip = t('pairing.enterTip', { path: [t('nav.settings'), t('settings.pairing'), t('pairing.show')].join(', ') })

  return (
    <Card title={t('pairing.phraseTitle')} hint={t('pairing.phraseHint')} hueIndex={hueIndex}>
      <div className="flex flex-col gap-[1.125rem]" data-stage={stage}>
        {body}
      </div>
      {foot && <CardFoot>{foot}</CardFoot>}

      {shown === 'words' && (
        <Dialog
          title={t('pairing.wordsLabel')}
          hint={t('pairing.wordsTip')}
          hueIndex={hueIndex}
          width="wide"
          onClose={close}
          footer={
            <>
              <Button label={t('common.close')} labelKey="common.close" glyph={<IconClose />} onClick={close} />
              {phrase ? (
                <Button
                  label={copied ? t('common.copied') : t('common.copy')}
                  labelKey={copied ? 'common.copied' : 'common.copy'}
                  glyph={copied ? <IconCheck /> : <IconCopy />}
                  onClick={() => void copy()}
                />
              ) : (
                <Button
                  key={`show-${shake}`}
                  label={t('pairing.show')}
                  labelKey="pairing.show"
                  glyph={<IconEye />}
                  tone="accent"
                  busy={busy}
                  disabled={busy || password === ''}
                  className={shake ? 'glim-shake' : undefined}
                  onClick={() => void show()}
                />
              )}
            </>
          }
        >
          {phrase ? (
            <div className="flex flex-col gap-2">
              <WordSlots words={phrase.phrase.split(/\s+/)} label={t('pairing.wordsLabel')} code={phrase.code} />
              <p className="text-center text-meta text-carbon-textMuted sm:text-end">{t('pairing.qrCaption')}</p>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (password !== '') void show()
              }}
            >
              <FieldRow label={t('pairing.passwordLabel')} hint={t('pairing.passwordTip')}>
                <Secret value={password} onChange={setPassword} autoComplete="current-password" label={t('pairing.passwordLabel')} />
              </FieldRow>
            </form>
          )}
        </Dialog>
      )}
      {shown === 'enter' && <JoinWindow hint={`${t('pairing.enterSub')} ${tip}`} hueIndex={hueIndex} busy={busy} onPair={join} onClose={close} />}

      {leaving && (
        <ConfirmWindow
          title={t('pairing.leaveTitle')}
          message={t('pairing.leaveStakes')}
          confirmLabel={t('pairing.leave')}
          confirmLabelKey="pairing.leave"
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setLeaving(false)}
          onConfirm={() => {
            setLeaving(false)
            void leave()
          }}
        />
      )}
    </Card>
  )
}

/** The window that takes the words of the first instance. */
function JoinWindow({ hint, hueIndex, busy, onPair, onClose }: {
  hint: string
  hueIndex: number
  busy: boolean
  onPair: (phrase: string) => Promise<string | null>
  onClose: () => void
}) {
  const { t } = useT()
  const { field, paste, pair } = usePhraseEntry({ id: 'pairing-phrase', label: t('pairing.enterLabel'), busy, onPair })
  return (
    <Dialog
      title={t('pairing.enter')}
      hint={hint}
      hueIndex={hueIndex}
      width="wide"
      closeOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <Button label={t('common.close')} labelKey="common.close" glyph={<IconClose />} onClick={onClose} />
          {paste}
          {pair}
        </>
      }
    >
      {field}
    </Dialog>
  )
}

/** One of two ways forward, as a tile large enough to say what happens after it. */
function Choice({ glyph, title, sub, disabled = false, shaking = false, onClick }: {
  glyph: ReactNode
  title: string
  sub: string
  disabled?: boolean
  shaking?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-choice
      disabled={disabled}
      onClick={onClick}
      className={`grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3.5 rounded-control bg-carbon-surface2 p-4 text-start transition-colors enabled:hover:bg-carbon-surface3 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--focus-ring)]${
        shaking ? ' glim-shake' : ''
      }`}
    >
      <span className="grid h-11 w-11 place-items-center rounded-control bg-accent text-accentContrast">{glyph}</span>
      <span>
        <span className="block text-title font-semibold leading-snug text-carbon-text">{title}</span>
        <span className="mt-0.5 block text-subline leading-snug text-carbon-textSub">{sub}</span>
      </span>
    </button>
  )
}

/** The button to press on the other instance, along the path to it. */
function NextStep() {
  const { t } = useT()
  const path = [t('nav.settings'), t('settings.pairing'), t('pairing.enter')]
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-control bg-accentSoft px-4 py-3.5">
      <span className="row-span-2 grid h-7 w-7 place-items-center rounded-full bg-accent text-accentContrast">
        <PhraseGlyph kind="arrow" />
      </span>
      <strong className="text-body font-semibold text-carbon-text">{t('pairing.nextTitle')}</strong>
      <p className="text-body text-carbon-textSub">
        <span className="font-semibold text-carbon-text">
          {path.map((step, i) => (
            <span key={i}>
              {i > 0 && (
                <span className="mx-1 inline-block align-[-1px] text-carbon-textMuted">
                  <PhraseGlyph kind="chevron" size={12} />
                </span>
              )}
              {step}
            </span>
          ))}
        </span>{' '}
        {t('pairing.nextTail')}
      </p>
    </div>
  )
}
