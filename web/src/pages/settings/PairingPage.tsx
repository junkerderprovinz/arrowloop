import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { ConfirmWindow } from '../../components/ConfirmWindow'
import { OtherInstances } from '../../components/OtherInstances'
import { ToggleRow } from '../../components/ToggleRow'
import { FieldRow, Secret, Text } from '../../components/Field'
import {
  IconAdd,
  IconCheck,
  IconClose,
  IconConfirm,
  IconCopy,
  IconEye,
  IconImport,
  IconKeyRevoke,
  IconLink,
  IconPencil,
  IconSave,
  IconSignOut,
} from '../../components/glyphs'
import { QRCode } from '../../components/QRCode'
import { Empty, Stack, StateLine } from '../../components/Shell'
import { Selector } from '../../components/Selector'
import { api, type ConnectInfo, type RelayConfig, type RelayMode } from '../../lib/api'
import { inDesktopWindow } from '../../lib/desk'
import { Badge } from '../../lib/glimstone/Badge'
import { Button } from '../../lib/glimstone/Button'
import { Card } from '../../lib/glimstone/Card'
import { InfoBubble } from '../../lib/glimstone/InfoBubble'
import { useT } from '../../lib/i18n'
import { kindName, pairStage, refusalText, seenAgo, type PairStage } from '../../lib/pairing'
import { setNavPin, useNavPins } from '../../lib/navPins'
import { checkPhrase, PHRASE_WORDS } from '../../lib/phraseWords'
import { counter } from './rows'
import { navigate } from '../../lib/router'
import { useToast } from '../../lib/toast'

// How often the tile asks again who is there. Members come and go with the
// relay connection, which nothing pushes here, and asking is also what lets
// two instances meet and pin each other's key.
const REFRESH_MS = 10_000

/**
 * Pairing, as in KnightLoader and BombVault: three steps that explain it, the
 * twelve words, who came with them, and the relay that carries the rest.
 */
export function PairingPage() {
  const { t } = useT()
  const [group, setGroup] = useState<ConnectInfo | null>(null)
  const [relay, setRelay] = useState<RelayConfig | null>(null)
  const [error, setError] = useState(false)
  // Counts the reads and the answers the cards hand up, so a read that was out
  // while a newer answer came back cannot put back the state from before.
  const asked = useRef(0)

  const load = useCallback(() => {
    const read = ++asked.current
    Promise.all([api.connect(), api.relay()])
      .then(([g, r]) => {
        if (read !== asked.current) return
        setGroup(g)
        setRelay(r)
        setError(false)
      })
      .catch(() => read === asked.current && setError(true))
  }, [])

  const takeGroup = (g: ConnectInfo) => {
    asked.current++
    setGroup(g)
  }

  useEffect(() => {
    load()
    const id = window.setInterval(load, REFRESH_MS)
    return () => window.clearInterval(id)
  }, [load])

  return (
    <Stack>
      <div data-new="pairing">
        <PairingSteps />
      </div>
      {error && (
        <Card title={t('settings.pairing')} hueIndex={1}>
          <p className="text-subline text-statusFail">{t('pairing.loadError')}</p>
        </Card>
      )}
      {group && <PhraseCard group={group} onGroup={takeGroup} onRefresh={load} />}
      {group?.active && <GroupCard group={group} onGroup={takeGroup} onRefresh={load} />}
      <InstancesCard />
      {group && relay && (
        <RelayCard
          group={group}
          relay={relay}
          onRelay={(r) => {
            setRelay(r)
            load()
          }}
        />
      )}
    </Stack>
  )
}

/**
 * The Instances page on its tile, as Targets is on its own: the sidebar switch
 * in one card, and under it the page whole while it is not in the sidebar.
 */
function InstancesCard() {
  const { t } = useT()
  const pinned = useNavPins().instances
  return (
    <>
      <Card title={t('nav.instances')} hint={t('instances.hint')} hueIndex={3}>
        <ToggleRow
          label={t('settings.showInSidebar')}
          hint={t('settings.showInSidebarHint')}
          checked={pinned}
          onChange={(on) => setNavPin('instances', on)}
        />
        {pinned && (
          <div className="flex justify-end">
            <Button label={t('settings.open')} labelKey="settings.open" onClick={() => navigate('/instances')} />
          </div>
        )}
      </Card>
      {!pinned && <OtherInstances firstHue={4} />}
    </>
  )
}

/** Three numbered steps before any button does anything. */
function PairingSteps() {
  const { t } = useT()
  const steps: { title: string; body: ReactNode }[] = [
    { title: t('pairing.step1Title'), body: t('pairing.step1Body') },
    { title: t('pairing.step2Title'), body: emphasize(t('pairing.step2Body'), 'button', t('pairing.enter')) },
    { title: t('pairing.step3Title'), body: t('pairing.step3Body') },
  ]
  return (
    <Card title={t('pairing.howTitle')} hueIndex={0}>
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-control bg-carbon-surface2 p-4">
            <span className="flex items-center gap-2 text-body font-semibold text-carbon-text">
              <Badge tone="active" size="small" shape="circle">
                {i + 1}
              </Badge>
              {s.title}
            </span>
            <p className="text-subline text-carbon-textSub">{s.body}</p>
          </li>
        ))}
      </ol>
    </Card>
  )
}

/** A bold copy of what where text says {token}. */
function emphasize(text: string, token: string, what: string): ReactNode {
  const [before, after = ''] = text.split(`{${token}}`)
  return (
    <>
      {before}
      <strong className="font-semibold text-carbon-text">{what}</strong>
      {after}
    </>
  )
}

/**
 * The twelve words. Outside a group it offers to make a phrase or to enter
 * one; a phrase made here stays on the card with the way to the button on the
 * other instance. Inside a group it shows the words again and leaves.
 */
function PhraseCard({ group, onGroup, onRefresh }: { group: ConnectInfo; onGroup: (g: ConnectInfo) => void; onRefresh: () => void }) {
  const { t } = useT()
  const push = useToast()
  const [shown, setShown] = useState<{ phrase: string; code: string } | null>(null)
  const [createdHere, setCreatedHere] = useState(false)
  const [entering, setEntering] = useState(false)
  const [asking, setAsking] = useState(false)
  const [password, setPassword] = useState('')
  const [leaving, setLeaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  // Words shown here belong to the group they were shown for. Another tab can
  // leave it, and the poll is the only sign.
  const wasActive = useRef(group.active)
  useEffect(() => {
    if (wasActive.current && !group.active) {
      setShown(null)
      setCreatedHere(false)
    }
    wasActive.current = group.active
  }, [group.active])

  const stage = pairStage(group, group.joinedAgo, createdHere)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch (e) {
      push(refusalText(t, e), 'fail')
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    run(async () => {
      const made = await api.makePhrase()
      setShown({ phrase: made.phrase, code: made.code })
      setCreatedHere(true)
      onGroup(made.info)
    })

  const reveal = () =>
    run(async () => {
      setShown(await api.revealPhrase(password))
      setPassword('')
      setAsking(false)
    })

  const leave = () =>
    run(async () => {
      await api.leaveGroup()
      setShown(null)
      setCreatedHere(false)
      onRefresh()
    })

  async function copy() {
    if (!shown) return
    await navigator.clipboard?.writeText(shown.phrase)
    setCopied(true)
  }

  const noPassword = !group.passwordSet && !inDesktopWindow() && (
    <div className="flex flex-wrap items-center gap-3 rounded-control bg-statusWarnBgSoft px-3 py-2.5">
      <p className="min-w-0 flex-[1_1_18rem] text-subline text-carbon-text">{t('pairing.noPassword')}</p>
      <Button label={t('settings.security')} labelKey="settings.security" onClick={() => navigate('/settings/security')} />
    </div>
  )

  let body: ReactNode
  if (entering) {
    body = (
      <PhraseEntry
        onBack={() => setEntering(false)}
        onPaired={(g) => {
          setEntering(false)
          onGroup(g)
          push(t('pairing.joined'), 'success')
        }}
      />
    )
  } else if (stage === 'unpaired') {
    body = (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Choice glyph={<IconAdd />} title={t('pairing.create')} sub={t('pairing.createSub')} disabled={busy} onClick={() => void create()} />
        <Choice glyph={<IconPencil />} title={t('pairing.enter')} sub={t('pairing.enterSub')} onClick={() => setEntering(true)} />
      </div>
    )
  } else if (shown) {
    body = (
      <>
        <WordSlots words={shown.phrase.split(/\s+/)} label={t('pairing.wordsLabel')} code={shown.code} />
        <p className="flex items-center justify-end gap-1.5 text-subline text-carbon-textMuted">
          {t('pairing.qrCaption')}
          <InfoBubble tip={t('pairing.wordsTip')} />
        </p>
        <NextStep />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button label={t('common.close')} labelKey="common.close" glyph={<IconClose />} onClick={() => setShown(null)} />
          <Button
            label={copied ? t('common.copied') : t('common.copy')}
            labelKey={copied ? 'common.copied' : 'common.copy'}
            glyph={copied ? <IconCheck /> : <IconCopy />}
            onClick={() => void copy()}
          />
        </div>
      </>
    )
  } else {
    const lead =
      stage === 'alone' ? t('pairing.aloneLead') : stage === 'searching' || stage === 'new' ? t('pairing.searchingLead') : t('pairing.pairedLead')
    body = (
      <>
        <p className="text-subline text-carbon-textMuted">{lead}</p>
        {asking && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void reveal()
            }}
          >
            <FieldRow label={t('pairing.passwordLabel')} hint={t('pairing.passwordTip')}>
              <Secret value={password} onChange={setPassword} autoComplete="current-password" label={t('pairing.passwordLabel')} />
            </FieldRow>
            <div className="flex justify-end">
              <Button label={t('pairing.show')} labelKey="pairing.show" glyph={<IconEye />} type="submit" busy={busy} disabled={busy || password === ''} />
            </div>
          </form>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!asking && (
            <Button
              label={t('pairing.show')}
              labelKey="pairing.show"
              glyph={<IconEye />}
              disabled={busy}
              onClick={() => (group.passwordSet ? setAsking(true) : void reveal())}
            />
          )}
          <Button label={t('pairing.leave')} labelKey="pairing.leave" glyph={<IconSignOut />} disabled={busy} onClick={() => setLeaving(true)} />
        </div>
      </>
    )
  }

  return (
    <Card title={t('pairing.phraseTitle')} hint={t('pairing.phraseHint')} hueIndex={1}>
      <div className="flex flex-col gap-4" data-stage={stage}>
        {noPassword}
        {body}
      </div>
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

/** One of two ways forward, as a tile large enough to say what happens after it. */
function Choice({ glyph, title, sub, disabled = false, onClick }: { glyph: ReactNode; title: string; sub: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-choice
      disabled={disabled}
      onClick={onClick}
      className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3.5 rounded-control bg-carbon-surface2 p-4 text-start transition-colors enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--focus-ring)]"
    >
      <span className="grid h-11 w-11 place-items-center rounded-control bg-accent text-accentContrast [&_svg]:h-5 [&_svg]:w-5">{glyph}</span>
      <span>
        <span className="block text-body font-semibold text-carbon-text">{title}</span>
        <span className="mt-0.5 block text-subline text-carbon-textSub">{sub}</span>
      </span>
    </button>
  )
}

/** The way to the button to press on the other instance. */
function NextStep() {
  const { t } = useT()
  const path = [t('nav.settings'), t('settings.pairing'), t('pairing.enter')]
  return (
    <div className="flex flex-col gap-1 rounded-control bg-carbon-surface2 px-4 py-3">
      <strong className="text-body font-semibold text-carbon-text">{t('pairing.nextTitle')}</strong>
      <p className="text-subline text-carbon-textSub">
        {path.map((step, i) => (
          <span key={i}>
            {i > 0 && ' › '}
            <span className={i === path.length - 1 ? 'font-semibold text-carbon-text' : undefined}>{step}</span>
          </span>
        ))}{' '}
        {t('pairing.nextTail')}
      </p>
    </div>
  )
}

/**
 * The twelve words in numbered tiles, the same wherever they appear: shown to
 * be read out, or filling as somebody types them. Beside the QR code the rows
 * stretch to the code's height.
 */
export function WordSlots({ words, unknown = [], label, code }: { words: string[]; unknown?: number[]; label?: string; code?: string }) {
  const bad = new Set(unknown)
  const grid = (
    <ol className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4 sm:grid-rows-3" aria-label={label} aria-hidden={label ? undefined : true}>
      {Array.from({ length: PHRASE_WORDS }, (_, i) => {
        const w = words[i]
        const tone =
          w === undefined
            ? 'ring-1 ring-inset ring-carbon-border text-carbon-textMuted'
            : bad.has(i)
              ? 'bg-statusFailBg text-statusFail'
              : 'bg-carbon-surface2 text-carbon-text'
        return (
          <li key={i} data-slot={i + 1} className={`flex items-center gap-2 rounded-control px-3 py-1.5 text-subline ${tone}`}>
            <span className="w-5 shrink-0 text-end text-meta opacity-70">{i + 1}</span>
            <span dir="ltr" className="whitespace-nowrap font-mono">
              {w ?? '·'}
            </span>
          </li>
        )
      })}
    </ol>
  )
  if (!code) return grid
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
      {grid}
      <div className="flex shrink-0 justify-center sm:items-start">
        <QRCode value={code} size={136} className="rounded-control" />
      </div>
    </div>
  )
}

/**
 * Takes the twelve words of another instance. It reads a paste with line
 * breaks, list numbers and commas, fills the slots as the words arrive and
 * names an unknown word with its place before anything is sent. Pair waits for
 * twelve known words; whether they belong together only the engine can say.
 */
function PhraseEntry({ onBack, onPaired }: { onBack: () => void; onPaired: (g: ConnectInfo) => void }) {
  const { t } = useT()
  const [text, setText] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { words, unknown, complete } = checkPhrase(text)

  let problem = refusal
  if (!problem && unknown.length > 0) problem = t('pairing.errUnknownWord', { position: unknown[0] + 1, word: words[unknown[0]] })
  if (!problem && words.length > PHRASE_WORDS) problem = t('pairing.errWordCount', { count: words.length })

  async function paste() {
    try {
      setText(await navigator.clipboard.readText())
      setRefusal(null)
    } catch {
      setRefusal(t('pairing.pasteRefused'))
    }
  }

  async function pair() {
    setBusy(true)
    try {
      onPaired(await api.joinGroup(words.join(' ')))
    } catch (e) {
      setRefusal(refusalText(t, e))
    } finally {
      setBusy(false)
    }
  }

  const tip = t('pairing.enterTip', { path: [t('nav.settings'), t('settings.pairing'), t('pairing.show')].join(', ') })
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (complete) void pair()
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label htmlFor="pairing-phrase" className="inline-flex items-center gap-1.5 text-meta font-medium text-carbon-textSub">
          {t('pairing.enterLabel')}
          <InfoBubble tip={tip} />
        </label>
        <span className={`ms-auto text-meta ${complete ? 'text-statusOk' : 'text-carbon-textMuted'}`} aria-live="polite">
          {t('pairing.wordCount', { n: words.length })}
        </span>
      </div>
      <textarea
        id="pairing-phrase"
        value={text}
        rows={2}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="none"
        dir="ltr"
        aria-invalid={problem ? true : undefined}
        placeholder={t('pairing.enterPlaceholder')}
        onChange={(e) => {
          setText(e.target.value)
          setRefusal(null)
        }}
        className="w-full resize-y bg-carbon-surface2 px-3 py-2 font-mono text-meta text-carbon-text outline-none transition placeholder:font-sans placeholder:text-carbon-textMuted focus:brightness-125"
        style={{ borderRadius: 'var(--radius-control)' }}
      />
      <WordSlots words={words} unknown={unknown} />
      <p role="alert" className="text-subline text-statusFail empty:hidden">
        {problem ?? ''}
      </p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button label={t('preview.back')} labelKey="preview.back" onClick={onBack} />
        <Button label={t('pairing.paste')} labelKey="pairing.paste" glyph={<IconImport />} disabled={busy} onClick={() => void paste()} />
        <Button label={t('pairing.join')} labelKey="pairing.join" glyph={<IconLink />} type="submit" busy={busy} disabled={busy || !complete} />
      </div>
    </form>
  )
}

/**
 * Who is in the group: the instances that wait for approval, this instance
 * with its name and key, the others that are there and the approved ones that
 * are away, each with the button that takes it out.
 */
function GroupCard({ group, onGroup, onRefresh }: { group: ConnectInfo; onGroup: (g: ConnectInfo) => void; onRefresh: () => void }) {
  const { t, lang } = useT()
  const push = useToast()
  const [name, setName] = useState(group.name)
  const [busy, setBusy] = useState(false)
  const [asked, setAsked] = useState<{ kind: 'refuse' | 'remove'; id: string; name: string } | null>(null)
  const stage: PairStage = pairStage(group, group.joinedAgo, false)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
      onRefresh()
    } catch (e) {
      push(refusalText(t, e), 'fail')
    } finally {
      setBusy(false)
    }
  }

  const shownName = (n: string) => n || t('pairing.thisInstance')
  const nobody = group.members.length === 0 && group.away.length === 0 && group.pending.length === 0

  return (
    <Card title={t('pairing.groupTitle')} hint={t('pairing.groupHint')} hueIndex={2}>
      <div className="flex flex-col gap-4" data-stage={stage}>
        {group.awaiting && (
          <p role="status" className="rounded-control bg-statusWarnBgSoft px-3 py-2.5 text-subline text-carbon-text">
            {t('pairing.awaiting')}
          </p>
        )}

        {group.pending.length > 0 && (
          <section className="flex flex-col gap-2" aria-label={t('pairing.pendingTitle')}>
            <h3 className="flex items-center gap-1.5 text-meta font-medium uppercase tracking-wider text-carbon-textMuted">
              {t('pairing.pendingTitle')}
              <InfoBubble tip={t('pairing.pendingTip')} />
            </h3>
            <ul className="flex flex-col gap-2">
              {group.pending.map((p) => (
                <Row
                  key={p.id}
                  name={shownName(p.name)}
                  facts={[t('pairing.fingerprint', { fingerprint: p.fingerprint })]}
                  actions={
                    <>
                      <Button
                        label={t('pairing.refuse')}
                        labelKey="pairing.refuse"
                        glyph={<IconClose />}
                        disabled={busy}
                        onClick={() => setAsked({ kind: 'refuse', id: p.id, name: shownName(p.name) })}
                      />
                      <Button
                        label={t('pairing.approve')}
                        labelKey="pairing.approve"
                        glyph={<IconConfirm />}
                        tone="accent"
                        disabled={busy}
                        onClick={() => void run(() => api.approveMember(p.id))}
                      />
                    </>
                  }
                />
              ))}
            </ul>
          </section>
        )}

        <ul className="flex flex-col gap-2">
          <li className="flex flex-col gap-3 rounded-control bg-carbon-surface2 px-3 py-2.5">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-body font-semibold text-carbon-text">{t('pairing.thisInstance')}</span>
              <span className="text-subline text-carbon-textSub">{kindName(t, group.deployment)}</span>
              {group.fingerprint && (
                <span className="ms-auto inline-flex items-center gap-1.5 text-subline text-carbon-textMuted">
                  <span dir="ltr">{t('pairing.ownKey', { fingerprint: group.fingerprint })}</span>
                  <InfoBubble tip={t('pairing.ownKeyTip')} />
                </span>
              )}
            </span>
            <form
              className="flex flex-wrap items-center justify-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void run(async () => onGroup(await api.renameInstance(name)))
              }}
            >
              <div className="min-w-0 flex-1">
                <FieldRow label={t('pairing.nameLabel')} hint={t('pairing.nameHint')}>
                  <Text value={name} onChange={setName} label={t('pairing.nameLabel')} />
                </FieldRow>
              </div>
              <Button label={t('pairing.nameSave')} labelKey="pairing.nameSave" glyph={<IconSave />} type="submit" disabled={busy || name === group.name} />
            </form>
          </li>
          {group.members.map((m) => (
            <Row
              key={m.id}
              name={m.name}
              facts={[kindName(t, m.deployment), t('pairing.online'), m.approved ? t('pairing.approved') : '']}
              live
              actions={
                <Button
                  label={t('pairing.remove')}
                  labelKey="pairing.remove"
                  glyph={<IconKeyRevoke />}
                  disabled={busy}
                  onClick={() => setAsked({ kind: 'remove', id: m.id, name: m.name })}
                />
              }
            />
          ))}
          {group.away.map((m) => (
            <Row
              key={m.id}
              name={m.name}
              facts={[kindName(t, m.deployment), t('pairing.lastSeen', { time: seenAgo(lang, m.lastSeen) })]}
              actions={
                <Button
                  label={t('pairing.remove')}
                  labelKey="pairing.remove"
                  glyph={<IconKeyRevoke />}
                  disabled={busy}
                  onClick={() => setAsked({ kind: 'remove', id: m.id, name: m.name })}
                />
              }
            />
          ))}
        </ul>
        {nobody && <Empty>{t('pairing.nobodyYet')}</Empty>}
      </div>

      {asked && (
        <ConfirmWindow
          title={asked.kind === 'refuse' ? t('pairing.refuseTitle', { name: asked.name }) : t('pairing.removeTitle', { name: asked.name })}
          message={asked.kind === 'refuse' ? t('pairing.refuseConfirm', { name: asked.name }) : t('pairing.removeConfirm', { name: asked.name })}
          confirmLabel={asked.kind === 'refuse' ? t('pairing.refuse') : t('pairing.remove')}
          confirmLabelKey={asked.kind === 'refuse' ? 'pairing.refuse' : 'pairing.remove'}
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setAsked(null)}
          onConfirm={() => {
            const { kind, id } = asked
            setAsked(null)
            void run(() => (kind === 'refuse' ? api.refuseMember(id) : api.removeMember(id)))
          }}
        />
      )}
    </Card>
  )
}

/** One instance of the group: its name, what it is and how it stands, and what can be done about it. */
function Row({ name, facts, live = false, actions }: { name: string; facts: string[]; live?: boolean; actions?: ReactNode }) {
  return (
    <li className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-control bg-carbon-surface2 px-3 py-1.5">
      <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${live ? 'bg-statusOkSolid' : 'bg-carbon-textMuted'}`} />
      <span className="min-w-0 text-body font-semibold text-carbon-text [overflow-wrap:anywhere]">{name}</span>
      <span className="text-subline text-carbon-textSub">{facts.filter(Boolean).join(' · ')}</span>
      {actions && <span className="ms-auto flex flex-wrap items-center gap-2">{actions}</span>}
    </li>
  )
}

/**
 * Which relay carries the group: the project's, one of the owner's own, or
 * none, with what each one sees.
 */
function RelayCard({ group, relay, onRelay }: { group: ConnectInfo; relay: RelayConfig; onRelay: (r: RelayConfig) => void }) {
  const { t } = useT()
  const push = useToast()
  const [address, setAddress] = useState(relay.relayUrl)
  const [busy, setBusy] = useState(false)

  async function save(change: { mode?: RelayMode; relayUrl?: string }) {
    setBusy(true)
    try {
      onRelay(await api.saveRelay(change))
    } catch (e) {
      push(refusalText(t, e), 'fail')
    } finally {
      setBusy(false)
    }
  }

  const host = (() => {
    try {
      return new URL(relay.projectRelayUrl).host
    } catch {
      return relay.projectRelayUrl
    }
  })()
  const selectorHue = counter()
  const sentence =
    relay.mode === 'project' ? t('relay.projectSentence', { host }) : relay.mode === 'own' ? t('relay.ownSentence') : t('relay.offSentence')

  return (
    <Card title={t('relay.title')} hint={t('relay.hint')} hueIndex={5}>
      <div className="flex flex-col gap-4">
        <Selector<RelayMode>
          options={[
            { value: 'project', label: t('relay.project') },
            { value: 'own', label: t('relay.own') },
            { value: 'off', label: t('relay.off') },
          ]}
          value={relay.mode}
          onChange={(mode) => void save({ mode })}
          label={t('relay.title')}
          disabled={busy}
          scale="small"
          hue={selectorHue()}
        />
        <p className="text-subline text-carbon-textSub">{sentence}</p>
        {relay.mode === 'own' && (
          <form
            className="flex flex-wrap items-center justify-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void save({ relayUrl: address })
            }}
          >
            <div className="min-w-0 flex-1">
              <FieldRow label={t('relay.address')}>
                <Text value={address} onChange={setAddress} mono label={t('relay.address')} placeholder="wss://relay.example.org" />
              </FieldRow>
            </div>
            <Button label={t('relay.save')} labelKey="relay.save" glyph={<IconSave />} type="submit" disabled={busy || address === relay.relayUrl} />
          </form>
        )}
        {relay.mode !== 'off' &&
          (group.active ? (
            <StateLine on={relay.connected}>{relay.connected ? t('relay.connected') : t('relay.notConnected')}</StateLine>
          ) : (
            <p className="text-subline text-carbon-textMuted">{t('relay.noGroup')}</p>
          ))}
        {relay.mode !== 'off' && (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-subline md:grid-cols-[auto_1fr]">
            <dt className="font-medium text-carbon-text">{t('relay.seesLabel')}</dt>
            <dd className="text-carbon-textSub">{t('relay.sees')}</dd>
            <dt className="font-medium text-carbon-text">{t('relay.notSeesLabel')}</dt>
            <dd className="text-carbon-textSub">{t('relay.notSees')}</dd>
          </dl>
        )}
      </div>
    </Card>
  )
}
