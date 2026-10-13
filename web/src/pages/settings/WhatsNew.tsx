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
import { markSeen, useWhatsNew, type WhatsNew } from '../../lib/whatsNewStore'

type View = 'changelog' | 'changes'

type Notes = { version: string; body: string }[]

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

/** The release notes of the running version and the ones before it, read from the engine. */
function Changelog({ notes }: { notes: Notes | null | 'failed' }) {
  const { t } = useT()
  if (notes === null) return <p className="py-2 text-subline text-carbon-textMuted">{t('new.loading')}</p>
  if (notes === 'failed' || notes.length === 0) {
    return <p className="py-2 text-body text-carbon-textSub">{t('new.loadFailed')}</p>
  }
  return (
    <div className="flex flex-col gap-6">
      {notes.map((note) => (
        <section key={note.version} data-release={note.version} className="flex flex-col gap-1.5">
          <h3 className="glim-eyebrow font-semibold">{note.version.replace(/^v/, '')}</h3>
          <ReleaseNotes body={note.body} />
        </section>
      ))}
    </div>
  )
}

/** What the last update changed, page by page with the way to each change. */
function Changes({ news, onClose }: { news: WhatsNew; onClose: () => void }) {
  const { t } = useT()
  return (
    <div className="flex flex-col gap-4">
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
 * The release notes and what the last update changed, one view each, as
 * BombVault's What's new window with the changes beside it. The footer carries
 * the chosen view's own action: the releases on GitHub, or the one button that
 * marks every change as seen while something is left and shows everything
 * again once nothing is.
 */
function WhatsNewWindow({ news, onClose }: { news: WhatsNew; onClose: () => void }) {
  const { t } = useT()
  const [view, setView] = useState<View>('changelog')
  const [notes, setNotes] = useState<Notes | null | 'failed'>(null)
  const all = news.changes.map((c) => c.id)
  const left = news.unseen.length > 0
  const tag = releaseTag(news.version)
  // A build without a release tag has no number worth putting in the title.
  const title = /^v\d+\.\d+\.\d+$/.test(tag) ? t('new.windowTitle', { version: tag.slice(1) }) : t('new.title')

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

  return (
    <Dialog
      title={title}
      hint={t(view === 'changelog' ? 'new.changelogHint' : 'new.hint')}
      onClose={onClose}
      wide
      bar={
        <Selector<View>
          label={t('new.title')}
          value={view}
          onChange={setView}
          options={[
            { value: 'changelog', label: t('new.changelog') },
            { value: 'changes', label: t('new.changes') },
          ]}
        />
      }
      footer={
        <>
          {view === 'changelog' ? (
            <Button
              label={t('new.releases')}
              labelKey="new.releases"
              glyph={<IconGithub />}
              onClick={() => openExternal(`${REPO}/releases`)}
              className="me-auto"
            />
          ) : (
            <Button
              label={`${t(left ? 'new.markAll' : 'new.showAll')} · ${left ? news.unseen.length : all.length}`}
              labelKey={left ? 'new.markAll' : 'new.showAll'}
              glyph={left ? <IconCheck /> : <IconEye />}
              onClick={() => markSeen(all, left)}
              className="me-auto"
            />
          )}
          <Button label={t('common.close')} labelKey="common.close" glyph={<IconClose />} onClick={onClose} />
        </>
      }
    >
      {view === 'changelog' ? <Changelog notes={notes} /> : <Changes news={news} onClose={onClose} />}
    </Dialog>
  )
}

/**
 * "New · 5" in the Version card, the number being what is still unseen. Its
 * dot turns grey and the number goes once nothing is left. It opens the
 * What's new window.
 */
export function WhatsNewButton() {
  const { t } = useT()
  const news = useWhatsNew()
  const [open, setOpen] = useState(false)
  if (!news || news.changes.length === 0) return null
  const left = news.unseen.length

  return (
    <>
      <Button
        label={left > 0 ? `${t('new.button')} · ${left}` : t('new.button')}
        labelKey={null}
        glyph={<i aria-hidden className={`glim-new-dot glim-new-dot-still${left > 0 ? '' : ' glim-new-dot-seen'}`} />}
        keepLabel
        onClick={() => setOpen(true)}
      />
      {open && <WhatsNewWindow news={news} onClose={() => setOpen(false)} />}
    </>
  )
}
