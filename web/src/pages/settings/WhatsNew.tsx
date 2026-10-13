import { useEffect, useState } from 'react'

import { IconGithub } from '../../components/brandGlyphs'
import { Dialog } from '../../components/Dialog'
import { IconCheck, IconClose, IconEye, IconLink } from '../../components/glyphs'
import { ReleaseNotes } from '../../components/ReleaseNotes'
import { Selector } from '../../components/Selector'
import { api } from '../../lib/api'
import { REPO } from '../../lib/donate'
import { openExternal } from '../../lib/external'
import { releaseTag } from '../../lib/glimstone/AboutCard'
import { Button } from '../../lib/glimstone/Button'
import { useT, type Translate } from '../../lib/i18n'
import { navigate } from '../../lib/router'
import { goOf, sentenceOf, type Change } from '../../lib/whatsNew'
import {
  closeNewsWindow,
  markSeen,
  openNewsWindow,
  useNewsWindow,
  useWhatsNew,
  type NewsTab,
  type WhatsNew,
} from '../../lib/whatsNewStore'

type Note = { version: string; body: string }

/** The changes of each page together, in the order the list first names the pages. */
function byPage(changes: Change[], t: Translate): { name: string; changes: Change[] }[] {
  const pages: { name: string; changes: Change[] }[] = []
  for (const change of changes) {
    const name = change.where.map((key) => t(key)).join(' › ')
    const page = pages.find((p) => p.name === name)
    if (page) page.changes.push(change)
    else pages.push({ name, changes: [change] })
  }
  return pages
}

/** The release notes of the running version, as the engine carries them. */
function Notes({ note }: { note: Note | null | 'failed' }) {
  const { t } = useT()
  if (note === null) return <p className="py-2 text-subline text-carbon-textMuted">{t('new.loading')}</p>
  if (note === 'failed') return <p className="py-2 text-body text-carbon-textSub">{t('new.loadFailed')}</p>
  return (
    <section data-release={note.version} className="flex flex-col gap-1.5">
      <ReleaseNotes body={note.body} />
    </section>
  )
}

/**
 * What the last update changed, page by page with the way to each change. One
 * toggle at the top marks everything as seen while something is left and
 * shows it all again once nothing is, since hiding the dots and having seen
 * the changes are the same act.
 */
function Changes({ news, onClose }: { news: WhatsNew; onClose: () => void }) {
  const { t } = useT()
  const all = news.changes.map((c) => c.id)
  const left = news.unseen.length > 0
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          label={`${t(left ? 'new.markAll' : 'new.showAll')} · ${left ? news.unseen.length : all.length}`}
          labelKey={left ? 'new.markAll' : 'new.showAll'}
          glyph={left ? <IconCheck /> : <IconEye />}
          keepLabel
          onClick={() => markSeen(all, left)}
        />
      </div>
      {byPage(news.changes, t).map((page) => (
        <section key={page.name} className="flex flex-col gap-1.5">
          <h3 className="glim-eyebrow font-semibold">{page.name}</h3>
          <ul className="flex flex-col gap-1.5">
            {page.changes.map((change) => {
              const seen = news.seen.has(change.id)
              return (
                <li
                  key={change.id}
                  data-change={change.id}
                  data-seen={seen || undefined}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control bg-carbon-surface2 px-3 py-2.5${seen ? ' opacity-55' : ''}`}
                >
                  <i aria-hidden className={`glim-new-dot glim-new-dot-still${seen ? ' glim-new-dot-seen' : ''}`} />
                  <span className="min-w-0 flex-[1_1_12rem] text-subline text-carbon-text">{sentenceOf(t, change)}</span>
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
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

/**
 * "New in 1.9.0": the release notes and what the last update changed, as two
 * tabs of one window. A release without marked changes shows its notes alone.
 * The foot leads to the releases on GitHub at its start and closes at its end.
 */
function WhatsNewWindow({ tab, news, onClose }: { tab: NewsTab; news: WhatsNew | null; onClose: () => void }) {
  const { t } = useT()
  const [note, setNote] = useState<Note | null | 'failed'>(null)
  const listed = !!news && news.changes.length > 0
  const shown: NewsTab = listed ? tab : 'notes'
  const tag = releaseTag(news?.version ?? '')
  // A build without a release tag has no number worth putting in the title.
  const title = /^v\d+\.\d+\.\d+$/.test(tag) ? t('new.windowTitle', { version: tag.slice(1) }) : t('new.title')

  useEffect(() => {
    let live = true
    api
      .releaseNotes()
      // Newest first, and never past the running version.
      .then((got) => live && setNote(got.notes[0] ?? 'failed'))
      .catch(() => live && setNote('failed'))
    return () => {
      live = false
    }
  }, [])

  return (
    <Dialog
      title={title}
      hint={t(shown === 'notes' ? 'new.notesHint' : 'new.hint')}
      onClose={onClose}
      wide
      bar={
        listed && (
          <Selector<NewsTab>
            label={title}
            value={shown}
            onChange={openNewsWindow}
            options={[
              { value: 'notes', label: t('about.releaseNotes') },
              {
                value: 'changes',
                label: news.unseen.length > 0 ? `${t('new.changes')} · ${news.unseen.length}` : t('new.changes'),
              },
            ]}
          />
        )
      }
      footer={
        <>
          <Button
            label={t('new.releases')}
            labelKey="new.releases"
            glyph={<IconGithub />}
            onClick={() => openExternal(`${REPO}/releases`)}
            className="me-auto"
          />
          <Button label={t('common.close')} labelKey="common.close" glyph={<IconClose />} onClick={onClose} />
        </>
      }
    >
      {shown === 'changes' && news ? <Changes news={news} onClose={onClose} /> : <Notes note={note} />}
    </Dialog>
  )
}

/** The window wherever it was opened from: the Version card or an update. */
export function WhatsNewHost() {
  const tab = useNewsWindow()
  const news = useWhatsNew()
  if (!tab) return null
  return <WhatsNewWindow tab={tab} news={news} onClose={closeNewsWindow} />
}

/**
 * "New · 5" in the Version card, the number being what is still unseen. Its
 * dot turns grey and the number goes once nothing is left. It opens the window
 * on the list of changes.
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
      glyph={<i aria-hidden className={`glim-new-dot glim-new-dot-still${left > 0 ? '' : ' glim-new-dot-seen'}`} />}
      keepLabel
      onClick={() => openNewsWindow('changes')}
    />
  )
}
