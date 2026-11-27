import { useEffect, useRef, useState } from 'react'

import { Button } from '../lib/glimstone/Button'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { useT } from '../lib/i18n'
import { replay } from '../lib/animate'
import {
  joinUpstreams,
  joinWrapped,
  splitUpstreams,
  splitWrapped,
  targetChoiceLabel,
  type KnownTarget,
  type Upstream,
} from '../lib/wrappedTarget'
import { Choice, Field, FieldRow, Text } from './Field'
import { IconAction } from './IconAction'
import { IconAdd, IconCheckDraw, IconCopy, IconTrash } from './glyphs'

function targetOptions(targets: KnownTarget[], here: string) {
  return [{ value: '', label: here }, ...targets.map((t) => ({ value: t.name, label: targetChoiceLabel(t) }))]
}

/**
 * The remote setting of a wrapping target such as crypt: a saved target picked
 * by its name, and a folder in it. With no target picked the folder is a path
 * on this machine, which rclone takes too.
 */
export function WrapPick({
  label,
  hint,
  value,
  targets,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  targets: KnownTarget[]
  onChange: (next: string) => void
}) {
  const { t } = useT()
  const wrapped = splitWrapped(value, targets)
  return (
    <>
      <FieldRow label={label} hint={hint}>
        <span data-new="wrap-pick" className="block w-full">
          <Choice
            value={wrapped.target}
            onChange={(target) => onChange(joinWrapped({ ...wrapped, target }))}
            label={label}
            options={targetOptions(targets, t('targets.wrap.here'))}
          />
        </span>
      </FieldRow>
      <FieldRow label={t('targets.wrap.folder')} hint={t('targets.wrap.folderHint')}>
        <Text
          value={wrapped.folder}
          onChange={(folder) => onChange(joinWrapped({ ...wrapped, folder }))}
          placeholder={wrapped.target ? 'folder' : '/path'}
          hidePlaceholderOnFocus
          label={t('targets.wrap.folder')}
          mono
        />
      </FieldRow>
    </>
  )
}

/**
 * The upstreams of a union or combine, one row per target joined. A target
 * may come twice, with two folders, and a combine names the folder each one
 * appears under.
 */
export function UpstreamsPick({
  label,
  hint,
  value,
  targets,
  combine,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  targets: KnownTarget[]
  combine: boolean
  onChange: (next: string) => void
}) {
  const { t } = useT()
  // Kept here as well as in the value, since a row just added has nothing in
  // it yet and would not survive a round trip through the setting.
  const [rows, setRows] = useState<Upstream[]>(() => {
    const read = splitUpstreams(value, targets, combine)
    return read.length > 0 ? read : [blank(combine)]
  })
  const change = (next: Upstream[]) => {
    setRows(next)
    onChange(joinUpstreams(next, combine))
  }
  const patch = (at: number, part: Partial<Upstream>) => change(rows.map((r, i) => (i === at ? { ...r, ...part } : r)))
  const options = targetOptions(targets, t('targets.wrap.here'))

  return (
    <Field label={label} hint={hint} plain>
      <ul data-new="wrap-pick" className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            {combine && (
              <span className="w-36 max-sm:flex-1">
                <Text
                  value={row.dir ?? ''}
                  onChange={(dir) => patch(i, { dir })}
                  placeholder={t('targets.wrap.dir')}
                  hidePlaceholderOnFocus
                  label={t('targets.wrap.dir')}
                />
              </span>
            )}
            <span className="min-w-48 flex-[2_1_12rem]">
              <Choice
                value={row.target}
                onChange={(target) => patch(i, { target })}
                label={t('targets.wrap.joined')}
                options={options}
              />
            </span>
            <span className="min-w-36 flex-[1_1_9rem]">
              <Text
                value={row.folder}
                onChange={(folder) => patch(i, { folder })}
                placeholder={row.target ? 'folder' : '/path'}
                hidePlaceholderOnFocus
                label={t('targets.wrap.folder')}
                mono
              />
            </span>
            {/* Glyph alone in every label mode, or the row would break before it. */}
            <Button
              variant="icon"
              compact
              label={t('targets.wrap.remove')}
              labelKey="targets.wrap.remove"
              glyph={<IconTrash />}
              disabled={rows.length === 1}
              onClick={() => change(rows.filter((_, j) => j !== i))}
            />
          </li>
        ))}
      </ul>
      <Button
        label={t('targets.wrap.add')}
        labelKey="targets.wrap.add"
        glyph={<IconAdd />}
        onClick={() => setRows([...rows, blank(combine)])}
        className="self-start"
      />
    </Field>
  )
}

function blank(combine: boolean): Upstream {
  return combine ? { dir: '', target: '', folder: '', mode: '' } : { target: '', folder: '', mode: '' }
}

/** A saved target's id, which jobs, wrapping targets and rclone's own command line write before the colon. */
export function TargetId({ id }: { id: string }) {
  const { t } = useT()
  const [copied, setCopied] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (copied) replay(button.current, 'glim-confirm')
  }, [copied])

  return (
    <div data-new="target-id" className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
      <span className="flex min-w-0 flex-[1_1_12.5rem] items-center gap-1.5 text-body text-carbon-text">
        {t('targets.remoteId')}
        <InfoBubble tip={t('targets.remoteIdHint')} />
      </span>
      <span className="flex w-72 max-w-full items-center justify-end gap-2">
        <span className="min-w-0 truncate font-mono text-meta text-carbon-text select-all">{id}</span>
        <IconAction
          ref={button}
          title={copied ? t('targets.copied') : t('targets.copyId')}
          labelKey={copied ? 'targets.copied' : 'targets.copyId'}
          onClick={() => {
            void navigator.clipboard?.writeText(id).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? <IconCheckDraw className="glim-check-draw" /> : <IconCopy />}
        </IconAction>
      </span>
    </div>
  )
}
