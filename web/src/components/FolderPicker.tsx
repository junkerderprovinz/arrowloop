import { useEffect, useState } from 'react'

import { IconAction } from './IconAction'
import { Text } from './Field'
import { Rule } from './Shell'
import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { IconCancel, IconConfirm, IconFolder, IconNewFolder, IconTargets, IconUp } from './glyphs'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * Picks a folder that really exists, where a typo in a typed path would only
 * show up as a run that copied nothing. It sits beside the path field rather
 * than replacing it, since a path can also be a target name no listing offers.
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
  known?: { value: string; label: string }[]
  onPick: (path: string) => void
  onClose: () => void
}) {
  const { t } = useT()
  const [at, setAt] = useState('')
  const [parent, setParent] = useState('')
  const [entries, setEntries] = useState<{ name: string; path: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // null while the new-folder name box is closed.
  const [naming, setNaming] = useState<string | null>(null)

  // Each opening starts from the field it was opened from, not where the last
  // visit ended.
  useEffect(() => {
    if (!open) return
    setError(null)
    void go(start ?? '')
    // Listing go would re-run the effect on every keystroke in the field behind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, start])

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open, onClose])

  /**
   * Lists one folder. With fallback set, an unusable starting path (often a
   * placeholder or a path from another machine) opens the top of the tree
   * instead of a dead end; a folder navigated to keeps its error.
   */
  async function go(path: string, fallback = true) {
    setBusy(true)
    try {
      const answer = await api.browse(path || undefined)
      setAt(answer.path)
      setParent(answer.parent)
      setEntries(answer.entries)
      setError(null)
    } catch (e) {
      if (fallback && path) {
        setBusy(false)
        return go('', false)
      }
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function create() {
    const name = (naming ?? '').trim()
    if (!at || name === '') return
    setBusy(true)
    setError(null)
    try {
      const made = await api.makeDir(at, name)
      setNaming(null)
      await go(made.path, false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.45)] p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t('pick.title')}
      onClick={onClose}
    >
      {/* Wide enough for the three footer buttons in one row in German, since
          that row does not wrap. */}
      <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <Card
          title={t('pick.title')}
        >
          <p className="mb-3 truncate font-mono text-xs text-carbon-text" title={at}>
            {at || t('pick.roots')}
          </p>

          {error && <p className="mb-3 text-xs text-statusFail">{error}</p>}

          <ul className="flex max-h-72 flex-col overflow-y-auto">
            {/* Drives and targets cannot be reached by walking the tree, so they
                come first, and picking one is the answer. */}
            {known.map((k) => (
              <li key={k.value}>
                <button
                  type="button"
                  onClick={() => onPick(k.value)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-xs transition hover:bg-carbon-hover"
                  style={{ borderRadius: 'var(--radius-control)' }}
                >
                  <span className="shrink-0 text-carbon-textMuted" aria-hidden>
                    <IconTargets />
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
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-xs text-carbon-textMuted transition hover:bg-carbon-hover hover:text-carbon-text"
                  style={{ borderRadius: 'var(--radius-control)' }}
                >
                  <IconUp />
                  {t('pick.up')}
                </button>
              </li>
            )}
            {entries.length === 0 && !busy ? (
              <li className="px-2 py-3 text-xs text-carbon-textMuted">{t('pick.empty')}</li>
            ) : (
              entries.map((e) => (
                <li key={e.path}>
                  <button
                    type="button"
                    onClick={() => void go(e.path, false)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-xs transition hover:bg-carbon-hover"
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

          {/* Choosing takes the folder currently open rather than a highlighted
              row, so walking in and pressing the button is one gesture. */}
          <div className="flex items-center justify-end gap-2">
            {/* Makes one folder inside the open one; a name with a separator
                is refused. */}
            <Button
              label={t('pick.newFolder')}
              labelKey="pick.newFolder"
              glyph={<IconNewFolder />}
              disabled={!at || busy}
              onClick={() => setNaming('')}
              className="me-auto"
            />
            <Button
              label={t('pick.cancel')}
              labelKey="pick.cancel"
              glyph={<IconCancel />}
              onClick={onClose}
            />
            <Button
              label={t('pick.choose')}
              labelKey="pick.choose"
              glyph={<IconConfirm />}
              tone="accent"
              disabled={!at}
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
                glyph={<IconConfirm />}
                tone="accent"
                disabled={naming.trim() === '' || busy}
                onClick={() => void create()}
              />
              <Button
                label={t('pick.cancel')}
                labelKey="pick.cancel"
                glyph={<IconCancel />}
                onClick={() => setNaming(null)}
              />
            </div>
          )}
        </Card>
      </div>
    </div>
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
