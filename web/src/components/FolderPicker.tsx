import { useEffect, useState } from 'react'

import { IconAction } from './IconAction'
import { Text } from './Field'
import { Button } from '../lib/glimstone/Button'
import { Card } from '../lib/glimstone/Card'
import { IconCancel, IconCheck, IconFolder, IconNewFolder, IconUp } from './glyphs'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'

/**
 * Picking a folder instead of typing one.
 *
 * A typed path is where a job goes wrong quietly: a folder that does not exist
 * is a perfectly valid string, so the first anybody hears of a typo is a run
 * that copied nothing, or one that made the wrong tree and then kept it in step
 * with the right one. A picker can only offer folders that are really there.
 *
 * The field stays. This is a button beside it, not a replacement for it,
 * because a path can also be a target's own name with a colon, which no
 * folder listing will ever produce, and because pasting a path somebody was
 * given is faster than walking to it.
 */
export function FolderPicker({
  open,
  start,
  onPick,
  onClose,
}: {
  open: boolean
  /** Where to begin. An unusable value simply starts at the top. */
  start?: string
  onPick: (path: string) => void
  onClose: () => void
}) {
  const { t } = useT()
  const [at, setAt] = useState('')
  const [parent, setParent] = useState('')
  const [entries, setEntries] = useState<{ name: string; path: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // null while the name box is closed, a string while it is open. An empty
  // string is a box waiting to be typed in, which is not the same as no box.
  const [naming, setNaming] = useState<string | null>(null)

  // Reset to the starting folder every time it opens, rather than resuming
  // wherever the last visit ended: this is opened from a specific field, and
  // that field's own value is the answer to "where were we".
  useEffect(() => {
    if (!open) return
    setError(null)
    void go(start ?? '')
    // go is defined below and stable for the life of this render; listing it
    // here would re-run the effect on every keystroke in the field behind.
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
   * Lists one folder, falling back to the top of the tree when it cannot.
   *
   * The fallback is what makes this usable at all on a fresh job: the field it
   * opens from holds whatever was typed, which on a machine that has never run
   * this job is very often a path from somewhere else, or a placeholder, or
   * nothing that exists. Opening on an error and an empty list would leave
   * somebody stuck at a dialog that refuses to show them anything, with no way
   * up because there is no folder to be above.
   *
   * A folder somebody NAVIGATED to and cannot read is a different matter and
   * keeps its message: there the listing behind it is still on screen and the
   * message says which folder refused.
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
      <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <Card
          title={t('pick.title')}
        >
          {/* Where we are, in full, because the whole point is to end up with a
              path somebody can read back. */}
          <p className="mb-3 truncate font-mono text-xs text-carbon-text" title={at}>
            {at || t('pick.roots')}
          </p>

          {error && <p className="mb-3 text-xs text-statusFail">{error}</p>}

          <ul className="flex max-h-72 flex-col overflow-y-auto">
            {at && (
              <li>
                <button
                  type="button"
                  onClick={() => void go(parent, false)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-xs text-carbon-textMuted transition hover:bg-carbon-hover hover:text-carbon-text"
                  style={{ borderRadius: 'var(--radius-control)' }}
                >
                  {/* An arrow, not a rotated plus. A plus turned upside down is
                      still a plus, and it read as "add" in the one place that
                      means "back". */}
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

          {/* At the foot, which is where a window's own controls go. Choosing
              takes the folder currently OPEN rather than one highlighted in the
              list: walking into a folder and pressing the button is one
              gesture, selecting a row and then confirming is two, and the
              second is the one people forget. */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Making a folder belongs HERE, at the moment somebody discovers
                the one they wanted does not exist yet. The alternative is
                leaving the picker, making it elsewhere, and coming back. It
                acts on the folder currently open, and refuses a name with a
                separator in it: this makes ONE folder, it does not take a
                path. */}
            <Button
              label={t('pick.newFolder')}
              labelKey={null}
              glyph={<IconNewFolder />}
              disabled={!at || busy}
              onClick={() => setNaming('')}
              className="me-auto"
            />
            <Button
              label={t('pick.cancel')}
              labelKey={null}
              glyph={<IconCancel />}
              onClick={onClose}
            />
            <Button
              label={t('pick.choose')}
              labelKey={null}
              glyph={<IconCheck />}
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
                labelKey={null}
                glyph={<IconCheck />}
                tone="accent"
                disabled={naming.trim() === '' || busy}
                onClick={() => void create()}
              />
              <Button
                label={t('pick.cancel')}
                labelKey={null}
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
    <IconAction title={t('pick.open')} onClick={onClick}>
      <IconFolder />
    </IconAction>
  )
}
