import { useRef } from 'react'

import { IconClose, IconSearch } from './glyphs'
import { CONTROL_H } from './Field'
import { useT } from '../lib/i18n'

/**
 * The search at the top end of a picker window. It is an open field from the
 * moment the window opens, since a list of some forty brands is searched
 * rather than read. Escape empties it first, and only an empty field lets the
 * window close.
 */
export function PickerSearch({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (next: string) => void
  /** Names what it searches, as its placeholder and accessible name. */
  label: string
}) {
  const { t } = useT()
  const field = useRef<HTMLInputElement>(null)

  return (
    <div
      className={`flex ${CONTROL_H} w-64 items-center gap-2 bg-carbon-surface2 pe-1 ps-3 transition has-[input:focus]:brightness-125 max-sm:w-full`}
      style={{ borderRadius: 'var(--radius-control)' }}
    >
      <span className="shrink-0 text-carbon-textMuted" aria-hidden>
        <IconSearch />
      </span>
      <input
        ref={field}
        type="search"
        value={value}
        aria-label={label}
        placeholder={label}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || !value) return
          // The window listens for Escape on the document, which this keeps it from hearing.
          e.stopPropagation()
          e.preventDefault()
          onChange('')
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-meta text-carbon-text outline-none placeholder:text-carbon-textMuted [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label={t('settings.searchClear')}
          data-tip={t('settings.searchClear')}
          onClick={() => {
            onChange('')
            field.current?.focus()
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-carbon-textSub transition-colors hover:bg-carbon-surface3"
        >
          <IconClose />
        </button>
      )}
    </div>
  )
}
