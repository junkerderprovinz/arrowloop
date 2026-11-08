import { useState, type ReactNode } from 'react'

import { IconImport, IconLink } from '../../../components/glyphs'
import { Button } from '../../../lib/glimstone/Button'
import { useT } from '../../../lib/i18n'
import { checkPhrase, PHRASE_WORDS } from '../../../lib/phraseWords'
import { WordSlots } from './WordSlots'

/**
 * Takes the twelve words of another instance, with its Paste and Pair buttons
 * apart for a window that puts them in its footer. It reads a paste with line
 * breaks, list numbers and commas, fills the slots as the words arrive and
 * names an unknown word with its place before anything is sent. Pair waits for
 * twelve known words; whether they belong together only the engine can say.
 */
export function usePhraseEntry({ id, label, busy, onPair }: {
  id: string
  label: string
  busy: boolean
  /** Sends the words, one space apart, and resolves to the refusal to show, or null once paired. */
  onPair: (phrase: string) => Promise<string | null>
}): { field: ReactNode; paste: ReactNode; pair: ReactNode } {
  const { t } = useT()
  const [text, setText] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [shake, setShake] = useState(0)
  const { words, unknown, complete } = checkPhrase(text)

  let problem = refusal
  const first = unknown[0]
  if (!problem && first !== undefined) problem = t('pairing.errUnknownWord', { position: first + 1, word: words[first] ?? '' })
  if (!problem && words.length > PHRASE_WORDS) problem = t('pairing.errWordCount', { count: words.length })

  // A browser that will not hand the clipboard over (plain HTTP, or the
  // permission refused) leaves the field to paste into by hand.
  async function paste() {
    try {
      setText(await navigator.clipboard.readText())
      setRefusal(null)
    } catch {
      setRefusal(t('pairing.pasteRefused'))
    }
    document.getElementById(id)?.focus()
  }

  async function pair() {
    const answer = await onPair(words.join(' '))
    if (answer === null) {
      setText('')
      return
    }
    setRefusal(answer)
    setShake((n) => n + 1)
  }

  const field = (
    <div className="flex flex-col gap-2">
      <span className={`glim-num self-end text-meta ${complete ? 'text-statusOk' : 'text-carbon-textMuted'}`} aria-live="polite">
        {t('pairing.wordCount', { n: words.length })}
      </span>
      <textarea
        id={id}
        value={text}
        rows={2}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="none"
        dir="ltr"
        aria-label={label}
        aria-invalid={problem ? true : undefined}
        placeholder={t('pairing.enterPlaceholder')}
        onChange={(e) => {
          setText(e.target.value)
          setRefusal(null)
        }}
        className="min-h-16 w-full resize-y bg-carbon-surface2 px-3 py-2.5 font-mono text-subline text-carbon-text outline-none transition placeholder:font-sans placeholder:text-carbon-textMuted focus:brightness-125"
        style={{ borderRadius: 'var(--radius-control)' }}
      />
      <WordSlots words={words} unknown={unknown} />
      <p role="alert" className="text-subline text-statusFail empty:hidden">
        {problem ?? ''}
      </p>
    </div>
  )
  const pasteButton = (
    <Button label={t('pairing.paste')} labelKey="pairing.paste" glyph={<IconImport />} disabled={busy} onClick={() => void paste()} />
  )
  const pairButton = (
    <Button
      key={`pair-${shake}`}
      label={t('pairing.join')}
      labelKey="pairing.join"
      glyph={<IconLink />}
      tone="accent"
      busy={busy}
      disabled={busy || !complete}
      className={shake ? 'glim-shake' : undefined}
      onClick={() => void pair()}
    />
  )
  return { field, paste: pasteButton, pair: pairButton }
}
