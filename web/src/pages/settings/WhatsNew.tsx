import { useState } from 'react'

import { Dialog } from '../../components/Dialog'
import { IconCheck, IconEye, IconLink } from '../../components/glyphs'
import { releaseTag } from '../../lib/glimstone/AboutCard'
import { Button } from '../../lib/glimstone/Button'
import { useT, type Translate } from '../../lib/i18n'
import { navigate } from '../../lib/router'
import { goOf, sentenceOf, type Change } from '../../lib/whatsNew'
import { markSeen, useWhatsNew, type WhatsNew } from '../../lib/whatsNewStore'

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

/**
 * What the last update changed, page by page with the way to each change. One
 * button marks everything as seen while something is left, which also hides
 * the dots, and shows everything again once nothing is. It counts what it
 * would mark.
 */
function WhatsNewWindow({ news, onClose }: { news: WhatsNew; onClose: () => void }) {
  const { t } = useT()
  const all = news.changes.map((c) => c.id)
  const left = news.unseen.length > 0
  const tag = releaseTag(news.version)
  // A build without a release tag has no number worth putting in the title.
  const title = /^v\d+\.\d+\.\d+$/.test(tag) ? t('new.windowTitle', { version: tag.slice(1) }) : t('new.title')

  return (
    <Dialog title={title} hint={t('new.hint')} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <div className="flex justify-end">
          <Button
            label={`${t(left ? 'new.markAll' : 'new.showAll')} · ${left ? news.unseen.length : all.length}`}
            labelKey={left ? 'new.markAll' : 'new.showAll'}
            glyph={left ? <IconCheck /> : <IconEye />}
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
    </Dialog>
  )
}

/**
 * "New · 5" in the Version card, the number being what is still unseen. Its
 * dot turns grey and the number goes once nothing is left. It opens the list
 * of changes in a window.
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
