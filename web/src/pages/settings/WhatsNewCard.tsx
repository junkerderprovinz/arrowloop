import { ToggleRow } from '../../components/ToggleRow'
import { IconCheck, IconEye, IconLink } from '../../components/glyphs'
import { Button } from '../../lib/glimstone/Button'
import { Card } from '../../lib/glimstone/Card'
import { useT, type Translate } from '../../lib/i18n'
import { navigate } from '../../lib/router'
import { goOf, sentenceOf, type Change } from '../../lib/whatsNew'
import { markSeen, showDots, useWhatsNew } from '../../lib/whatsNewStore'

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
 * What the last update changed, page by page with the way to each change, and
 * the switch for the dots that mark them. A change somebody has clicked away
 * stays listed, dimmed, and the count says what is left.
 */
export function WhatsNewCard({ hueIndex }: { hueIndex?: number }) {
  const { t } = useT()
  const news = useWhatsNew()
  if (!news || news.changes.length === 0) return null
  const all = news.changes.map((c) => c.id)

  return (
    <Card title={t('new.title')} hint={t('new.hint')} hueIndex={hueIndex}>
      <ToggleRow label={t('new.dots')} checked={news.dots} onChange={showDots} />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 data-testid="new-left" className="text-body font-semibold text-carbon-text">
          {t('new.count', { count: news.unseen.length })}
        </h3>
        <span className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <Button
            label={t('new.showAll')}
            labelKey="new.showAll"
            glyph={<IconEye />}
            onClick={() => markSeen(all, false)}
            disabled={news.seen.size === 0}
          />
          <Button
            label={t('new.markAll')}
            labelKey="new.markAll"
            glyph={<IconCheck />}
            onClick={() => markSeen(all)}
            disabled={news.unseen.length === 0}
          />
        </span>
      </div>
      {byPage(news.changes, t).map((page) => (
        <section key={page.name} className="flex flex-col gap-1.5">
          <h4 className="glim-eyebrow font-semibold">{page.name}</h4>
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
                    onClick={() => navigate(goOf(change))}
                    className="ms-auto"
                  />
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </Card>
  )
}
