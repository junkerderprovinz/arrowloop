import { useState, type ReactNode } from 'react'

import { Field, FieldRow, Secret } from '../../components/Field'
import { Button } from '../../lib/glimstone/Button'
import { InfoBubble } from '../../lib/glimstone/InfoBubble'
import { useT } from '../../lib/i18n'

/**
 * Hands out rainbow positions in the order it is asked, so the selectors on a
 * page count through the palette in the order they stand.
 */
export function counter(start = 0): () => number {
  let next = start
  return () => next++
}

/**
 * One setting on a line: its name at the start, the explanation behind an (i),
 * and a short control at the end. Where the row is too narrow for both, the
 * control moves under the name and keeps the row's end. A `wide` control, a
 * selector, takes the rest of the row and the whole row once it wraps, so its
 * segments share the width instead of sitting in a narrow block.
 */
export function SettingsRow({
  label,
  hint,
  wide = false,
  children,
}: {
  label: string
  hint?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
      {/* data-glim-label is where the settings search scrolls to. */}
      <span
        data-glim-label={label}
        className="flex min-w-0 flex-[1_1_12.5rem] items-center gap-1.5 text-body text-carbon-text"
      >
        {label}
        {hint && <InfoBubble tip={hint} />}
      </span>
      <div className={wide ? 'flex min-w-0 flex-[2_1_20rem]' : 'inline-flex max-w-full shrink-0'}>{children}</div>
    </div>
  )
}

/**
 * A group of rows inside a card under a small heading, one step up the surface
 * ramp. It sets a group apart without hiding it behind a fold.
 */
export function SubCard({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section className="glim-subcard flex flex-col gap-4 px-4 pb-4 pt-3">
      <h3 data-glim-label={label} className="glim-eyebrow flex items-center gap-1.5 font-semibold">
        {label}
        {hint && <InfoBubble tip={hint} />}
      </h3>
      {children}
    </section>
  )
}

/** What the server sends in place of a secret it keeps. */
const WITHHELD = '********'

/**
 * A stored secret, shown as "Saved" with a Change button rather than as a
 * field: the server never sends it back, so a field could only show dots that
 * are not the secret. While it is being changed the saved one stays until
 * something is typed, and Keep goes back to it. An empty secret has nothing to
 * protect and is a field straight away.
 */
export function SecretRow({
  label,
  hint,
  value,
  onChange,
  placeholder,
  stacked = false,
}: {
  label: string
  hint?: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  /** Keeps the name above Saved, for a form whose fields all carry it there. */
  stacked?: boolean
}) {
  const { t } = useT()
  const [changing, setChanging] = useState(false)
  const stored = value === WITHHELD

  if (stored && !changing) {
    const saved = (
      <span className="flex items-center gap-3">
        <span className="text-subline text-carbon-textSub">{t('notify.saved')}</span>
        <Button label={t('notify.change')} labelKey="notify.change" onClick={() => setChanging(true)} />
      </span>
    )
    return stacked ? (
      <Field label={label} hint={hint} plain>
        {saved}
      </Field>
    ) : (
      <SettingsRow label={label} hint={hint}>
        {saved}
      </SettingsRow>
    )
  }
  const field = <Secret value={stored ? '' : value} onChange={onChange} placeholder={placeholder} autoComplete="off" label={label} />
  const keep = changing && (
    <Button
      label={t('notify.keep')}
      labelKey="notify.keep"
      onClick={() => {
        setChanging(false)
        onChange(WITHHELD)
      }}
    />
  )
  if (!stacked) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="min-w-0 flex-[1_1_24rem]">
          <FieldRow label={label} hint={hint}>
            {field}
          </FieldRow>
        </div>
        {keep}
      </div>
    )
  }
  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <Field label={label} hint={hint}>
          {field}
        </Field>
      </div>
      {keep}
    </div>
  )
}
