import { useEffect, useId, useState, type CSSProperties } from 'react'

import { IconGithub } from '../../components/brandGlyphs'
import { Dialog } from '../../components/Dialog'
import { IconCheck, IconClose, IconEye, IconLink, IconWhatsNew } from '../../components/glyphs'
import { ReleaseNotes } from '../../components/ReleaseNotes'
import { api } from '../../lib/api'
import { hueVars } from '../../lib/appearance'
import { REPO } from '../../lib/donate'
import { openExternal } from '../../lib/external'
import { Badge } from '../../lib/glimstone/Badge'
import { Button } from '../../lib/glimstone/Button'
import { useT, type Translate } from '../../lib/i18n'
import { navigate } from '../../lib/router'
import {
  broughtBy,
  CHANGES,
  compareReleases,
  goOf,
  isRelease,
  placed,
  releaseNumber,
  sentenceOf,
  type Change,
} from '../../lib/whatsNew'
import { closeNewsWindow, markSeen, openNewsWindow, useNewsWindow, useWhatsNew, type WhatsNew } from '../../lib/whatsNewStore'

type Note = { version: string; body: string }

/** One card of the window: a release, or the running build when it is no release itself. */
interface Shown {
  /** The release number, or the running version for the build. */
  name: string
  note?: Note
  changes: Change[]
}

/** The changes of each page together, in the order the list first names the pages. Those no page draws come first. */
function byPage(changes: Change[], t: Translate): { name: string; changes: Change[] }[] {
  const pages: { name: string; changes: Change[] }[] = []
  for (const change of changes) {
    const name = placed(change) ? change.where.map((key) => t(key)).join(' › ') : t('new.where.background')
    const page = pages.find((p) => p.name === name)
    if (page) page.changes.push(change)
    else if (placed(change)) pages.push({ name, changes: [change] })
    else pages.unshift({ name, changes: [change] })
  }
  return pages
}

/**
 * The cards, newest first: every release since the one this browser had
 * before the last update, any release with a change still unseen, and the
 * running one. The engine's notes name the releases, those that brought
 * nothing for the list too. Without them every change lands on the running
 * version's card.
 */
function cardsOf(news: WhatsNew, notes: Note[] | null): Shown[] {
  const running = news.version
  const number = releaseNumber(running)
  const releases = new Set((notes ?? []).map((n) => releaseNumber(n.version)).filter((v) => v !== null))
  if (number) releases.add(number)
  const build = isRelease(running) ? number! : running.replace(/^v/, '')

  const cards = new Map<string, Shown>()
  const card = (name: string) => {
    let shown = cards.get(name)
    if (!shown) {
      shown = { name, note: notes?.find((n) => releaseNumber(n.version) === name), changes: [] }
      cards.set(name, shown)
    }
    return shown
  }
  const newest = [...releases].sort(compareReleases).at(-1)
  if (newest) card(newest)
  card(build)
  if (news.from) for (const release of releases) if (compareReleases(release, news.from) > 0) card(release)
  const release = (change: Change) => broughtBy(change, [...releases]) ?? build
  for (const change of news.changes) card(release(change))
  for (const change of CHANGES) cards.get(release(change))?.changes.push(change)

  // The build of what comes next stands above every release, and only while it brings something.
  const next = !isRelease(running)
  return [...cards.values()]
    .filter((s) => !(next && s.name === build) || s.changes.length > 0)
    .sort((a, b) => Number(next && b.name === build) - Number(next && a.name === build) || compareReleases(b.name, a.name))
}

function ChangeRow({ change, seen, onClose }: { change: Change; seen: boolean; onClose: () => void }) {
  const { t } = useT()
  return (
    <li
      data-change={change.id}
      data-seen={seen || undefined}
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control bg-carbon-surface px-3 py-2.5${seen ? ' opacity-55' : ''}`}
    >
      <i aria-hidden className={`glim-new-dot glim-new-dot-still${seen ? ' glim-new-dot-seen' : ''}`} />
      <span className="min-w-0 flex-[1_1_12rem] text-subline text-carbon-text">{sentenceOf(t, change)}</span>
      {placed(change) && (
        <Button
          label={t('new.go')}
          labelKey="new.go"
          glyph={<IconLink />}
          onClick={() => {
            onClose()
            navigate(goOf(change))
          }}
          className="ms-auto"
        />
      )}
    </li>
  )
}

/** One release as a card of its own: its number on the badge, its notes, and its changes page by page. */
function ReleaseCard({ shown, hueIndex, seen, onClose }: { shown: Shown; hueIndex: number; seen: ReadonlySet<string>; onClose: () => void }) {
  const { t } = useT()
  const id = useId()
  return (
    <section
      data-release={shown.name}
      aria-labelledby={id}
      className="relative glim-notch-card glim-hue flex flex-col gap-4 rounded-card bg-carbon-surface2 p-5"
      style={hueVars(hueIndex) as CSSProperties}
    >
      <h3 id={id} className="flex items-center">
        <Badge tone="heading" size="heading" wrap hueIndex={hueIndex}>
          {shown.name}
        </Badge>
      </h3>
      {shown.note && <ReleaseNotes body={shown.note.body} />}
      {byPage(shown.changes, t).map((page) => (
        <div key={page.name} className="flex flex-col gap-1.5">
          <h4 className="glim-eyebrow font-semibold">{page.name}</h4>
          <ul className="flex flex-col gap-1.5">
            {page.changes.map((change) => (
              <ChangeRow key={change.id} change={change} seen={seen.has(change.id)} onClose={onClose} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/**
 * What the updates brought, one card per release since the one this browser
 * had before. One toggle at the top marks every listed change as seen while
 * something is left and shows them all again once nothing is, since hiding the
 * dots and having seen the changes are the same act. A change no page draws
 * counts as seen once the window that listed it closes. The foot leads to the
 * releases on GitHub at its start and closes at its end.
 */
function WhatsNewWindow({ news, onClose }: { news: WhatsNew; onClose: () => void }) {
  const { t } = useT()
  const [notes, setNotes] = useState<Note[] | null | 'failed'>(null)

  useEffect(() => {
    let live = true
    api
      .releaseNotes()
      .then((got) => live && setNotes(got.notes))
      .catch(() => live && setNotes('failed'))
    return () => {
      live = false
    }
  }, [])

  const cards = notes === null ? [] : cardsOf(news, notes === 'failed' ? null : notes)
  const listed = cards.flatMap((c) => c.changes)
  const left = listed.filter((c) => !news.seen.has(c.id))

  const running = news.version
  const number = releaseNumber(running)
  const past = number === null || (news.from !== '' && (compareReleases(number, news.from) > 0 || (number === news.from && !isRelease(running))))
  const title =
    news.from && past
      ? t('new.windowTitleSince', { version: news.from })
      : isRelease(running)
        ? t('new.windowTitle', { version: number! })
        : t('new.title')

  const close = () => {
    const read = left.filter((c) => !placed(c)).map((c) => c.id)
    if (read.length > 0) markSeen(read)
    onClose()
  }

  return (
    <Dialog
      title={title}
      hint={t('new.hint')}
      onClose={close}
      width="wide"
      footer={
        <>
          <Button
            label={t('new.releases')}
            labelKey="new.releases"
            glyph={<IconGithub />}
            onClick={() => openExternal(`${REPO}/releases`)}
            className="me-auto"
          />
          <Button label={t('common.close')} labelKey="common.close" glyph={<IconClose />} onClick={close} />
        </>
      }
    >
      {notes === null ? (
        <p className="py-2 text-subline text-carbon-textMuted">{t('new.loading')}</p>
      ) : (
        <div className="flex flex-col gap-6 pt-3">
          {notes === 'failed' && <p className="text-body text-carbon-textSub">{t('new.loadFailed')}</p>}
          {listed.length > 0 && (
            <div className="flex justify-end">
              <Button
                label={`${t(left.length > 0 ? 'new.markAll' : 'new.showAll')} · ${left.length > 0 ? left.length : listed.length}`}
                labelKey={left.length > 0 ? 'new.markAll' : 'new.showAll'}
                glyph={left.length > 0 ? <IconCheck /> : <IconEye />}
                keepLabel
                onClick={() => markSeen(listed.map((c) => c.id), left.length > 0)}
              />
            </div>
          )}
          {cards.map((shown, i) => (
            <ReleaseCard key={shown.name} shown={shown} hueIndex={i} seen={news.seen} onClose={close} />
          ))}
        </div>
      )}
    </Dialog>
  )
}

/** The window wherever it was opened from: the Version card or an update. */
export function WhatsNewHost() {
  const open = useNewsWindow()
  const news = useWhatsNew()
  if (!open || !news) return null
  return <WhatsNewWindow news={news} onClose={closeNewsWindow} />
}

/**
 * "New · 5" in the Version card, the number being what is still unseen. The
 * gift stands beside its dot, which turns grey once nothing is left, and the
 * number goes.
 */
export function WhatsNewButton() {
  const { t } = useT()
  const news = useWhatsNew()
  if (!news || news.changes.length === 0) return null
  const left = news.unseen.length

  return (
    <Button
      label={left > 0 ? `${t('new.button')} · ${left}` : t('new.button')}
      labelKey={null}
      glyph={
        <span className="flex items-center gap-1.5">
          <IconWhatsNew />
          <i aria-hidden className={`glim-new-dot glim-new-dot-still${left > 0 ? '' : ' glim-new-dot-seen'}`} />
        </span>
      }
      keepLabel
      onClick={openNewsWindow}
    />
  )
}
