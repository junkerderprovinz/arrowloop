import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { IconAction } from './IconAction'
import { Text } from './Field'
import { Rule } from './Shell'
import { ToggleRow } from './ToggleRow'
import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { IconAdd, IconBack, IconCheck, IconClose, IconFolder, IconFolderAdd, IconTabStorage } from './glyphs'
import { errorText } from '../lib/errorText'
import { useHost } from '../lib/host'
import { useT, type Translate } from '../lib/i18n'
import { useModal } from '../lib/modal'
import { useRemembered } from '../lib/remember'
import { labelledSide } from '../lib/targetLabels'

/**
 * A place the picker offers above the folders. A registered drive is taken as
 * it is; a target opens, so a folder on it can be chosen or made.
 */
export type Known = { value: string; label: string; browse?: boolean }

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

/**
 * The registered drives and the configured targets as the picker offers them.
 * A drive that is not plugged in cannot be opened and is taken whole.
 */
export function placeOffers(
  drives: { path: string; label: string; attached: boolean }[],
  targets: { name: string; label?: string }[],
  t: Translate,
): Known[] {
  return [
    ...drives.map((d) => ({ value: `${d.path}/`, label: `${t('edit.pickDrive')}: ${d.label}`, browse: d.attached })),
    // Offered by label and opened by id, which is what the side keeps.
    ...targets.map((r) => ({ value: `${r.name}:`, label: `${t('edit.pickRemote')}: ${r.label || r.name}`, browse: true })),
  ]
}

/**
 * Picks a folder that really exists, on this machine or on a configured
 * target, where a typo in a typed path would only show up as a run that copied
 * nothing. It sits beside the path field rather than replacing it, since a
 * path can also be typed by hand.
 */
export function FolderPicker({
  open,
  start,
  known = [],
  onPick,
  onClose,
}: {
  open: boolean
  /** Where to begin. An unusable value simply starts at the top. */
  start?: string
  /** Registered drives and configured targets, offered above the folders. */
  known?: Known[]
  onPick: (path: string) => void
  onClose: () => void
}) {
  const { t } = useT()
  const host = useHost()
  const title = host.name ? t('pick.titleOn', { name: host.name }) : t('pick.title')
  const [at, setAt] = useState('')
  const [shown, setShown] = useState('')
  const [parent, setParent] = useState('')
  const [entries, setEntries] = useState<{ name: string; path: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The folder being listed, named before it answers so the one just left
  // cannot pass for it. null while nothing is being opened.
  const [opening, setOpening] = useState<string | null>(null)
  // null while the new-folder name box is closed.
  const [naming, setNaming] = useState<string | null>(null)
  // One choice for every picker in this browser, since a hidden folder wanted
  // for one field is usually wanted for the next.
  const [hidden, setHidden] = useRemembered('arrowloop.picker.hidden', false, isBoolean)

  // Each opening starts from the field it was opened from, not where the last
  // visit ended.
  useEffect(() => {
    if (!open) return
    setError(null)
    setEntries([])
    void go(start ?? '')
    // Listing go would re-run the effect on every keystroke in the field behind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, start])

  const picker = useRef<HTMLDivElement>(null)
  useModal(picker, onClose, { open, focus: 'first' })

  /**
   * Lists one folder. With fallback set, an unusable starting path (often a
   * placeholder or a path from another machine) opens the top of the tree
   * instead of a dead end; a folder navigated to keeps its error.
   */
  async function go(path: string, fallback = true, withHidden = hidden) {
    setBusy(true)
    setOpening(path)
    try {
      const answer = await host.browse(path || undefined, withHidden)
      setAt(answer.path)
      setShown(answer.shown ?? '')
      setParent(answer.parent)
      setEntries(answer.entries)
      setError(null)
    } catch (e) {
      if (fallback && path) {
        setBusy(false)
        return go('', false)
      }
      setError(errorText(t, e))
    } finally {
      setBusy(false)
      setOpening(null)
    }
  }

  async function create() {
    const name = (naming ?? '').trim()
    if (!at || name === '' || !host.makeDir) return
    setBusy(true)
    setError(null)
    try {
      const made = await host.makeDir(at, name)
      setNaming(null)
      await go(made.path, false)
    } catch (e) {
      setError(errorText(t, e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const place = opening ? labelledSide(opening) : shown || labelledSide(at)

  // Portalled, since a card that animates in is a transformed ancestor and
  // would pin the fixed backdrop to itself instead of the window.
  return createPortal(
    <div
      ref={picker}
      className="glim-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      {/* Wide enough for the three footer buttons in one row in German, since
          that row does not wrap. */}
      <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <Card title={title}>
          <p className="mb-3 truncate font-mono text-subline text-carbon-text" title={place}>
            {place || t('pick.roots')}
          </p>

          {error && <p className="mb-3 text-subline text-statusFail">{error}</p>}

          <ul className="flex max-h-72 flex-col overflow-y-auto">
            {/* Drives and targets cannot be reached by walking the tree, so they
                come first and open like any folder. */}
            {known.map((k) => (
              <li key={k.value}>
                <button
                  type="button"
                  onClick={() => {
                    if (!k.browse) return onPick(k.value)
                    setEntries([])
                    void go(k.value, false)
                  }}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-meta transition hover:bg-hover"
                  style={{ borderRadius: 'var(--radius-control)' }}
                >
                  <span className="shrink-0 text-carbon-textMuted" aria-hidden>
                    <IconTabStorage />
                  </span>
                  <span className="truncate">{k.label}</span>
                </button>
              </li>
            ))}
            {known.length > 0 && <li className="my-1"><Rule /></li>}
            {at && (
              <li>
                <button
                  type="button"
                  onClick={() => void go(parent, false)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-meta text-carbon-textMuted transition hover:bg-hover hover:text-carbon-text"
                  style={{ borderRadius: 'var(--radius-control)' }}
                >
                  <IconBack />
                  {t('pick.up')}
                </button>
              </li>
            )}
            {/* A target can take a while to answer, and the folder just left
                or an empty list would meanwhile pass for the answer. */}
            {busy ? (
              <li className="px-2 py-3 text-subline text-carbon-textMuted">{t('pick.loading')}</li>
            ) : entries.length === 0 ? (
              <li className="px-2 py-3 text-subline text-carbon-textMuted">{t('pick.empty')}</li>
            ) : (
              entries.map((e) => (
                <li key={e.path}>
                  <button
                    type="button"
                    onClick={() => void go(e.path, false)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-meta transition hover:bg-hover"
                    style={{ borderRadius: 'var(--radius-control)' }}
                  >
                    <span className="shrink-0 text-carbon-textMuted" aria-hidden>
                      <IconFolder />
                    </span>
                    <span className="truncate">{e.name}</span>
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="my-3">
            <ToggleRow
              label={t('pick.hidden')}
              checked={hidden}
              onChange={(next) => {
                setHidden(next)
                // The roots hold no hidden folders, so only an open folder is listed again.
                if (at) void go(at, false, next)
              }}
            />
          </div>

          {/* Choosing takes the folder currently open rather than a highlighted
              row, so walking in and pressing the button is one gesture. */}
          <div className="flex items-center justify-end gap-2">
            {/* Makes one folder inside the open one; a name with a separator
                is refused. Another instance's folders are only looked at. */}
            {host.makeDir && (
              <Button
                label={t('pick.newFolder')}
                labelKey="pick.newFolder"
                glyph={<IconFolderAdd />}
                disabled={!at || busy}
                onClick={() => setNaming('')}
                className="me-auto"
              />
            )}
            <Button
              label={t('pick.cancel')}
              labelKey="pick.cancel"
              glyph={<IconClose />}
              onClick={onClose}
            />
            <Button
              label={t('pick.choose')}
              labelKey="pick.choose"
              glyph={<IconCheck />}
              tone="accent"
              disabled={!at || busy}
              onClick={() => {
                if (at) onPick(at)
              }}
            />
          </div>

          {naming !== null && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <Text value={naming} onChange={setNaming} placeholder={t('pick.newFolder')} mono />
              </div>
              <Button
                label={t('pick.create')}
                labelKey="pick.create"
                glyph={<IconAdd />}
                disabled={naming.trim() === '' || busy}
                onClick={() => void create()}
              />
              <Button
                label={t('pick.cancel')}
                labelKey="pick.cancel"
                glyph={<IconClose />}
                onClick={() => setNaming(null)}
              />
            </div>
          )}
        </Card>
      </div>
    </div>,
    document.body,
  )
}

/** The button that opens it, sized to sit beside a field. */
export function PickButton({ onClick }: { onClick: () => void }) {
  const { t } = useT()
  return (
    <IconAction title={t('pick.open')} labelKey="pick.open" onClick={onClick}>
      <IconFolder />
    </IconAction>
  )
}
