import { useState, type ReactNode } from 'react'

import { IconLock, IconPencil, IconRefresh } from './glyphs'
import { Button } from '../lib/glimstone/Button'
import { ConfirmDialog } from '../lib/glimstone/ConfirmDialog'
import { InfoBubble } from '../lib/glimstone/InfoBubble'
import { SETTING_LABEL, describeValue, inForce, type Defaults, type Inherited } from '../lib/follows'
import { useT } from '../lib/i18n'

/**
 * Override while the setting comes from the defaults, Use the default once the
 * job has its own value. Going back asks first, since the own value is lost
 * (GlimStone, "Defaults and exceptions").
 */
export function InheritButton({
  setting,
  own,
  defaults,
  onOverride,
  onInherit,
}: {
  setting: Inherited
  own: boolean
  defaults: Defaults | undefined
  onOverride: () => void
  onInherit: () => void
}) {
  const { t } = useT()
  const [asking, setAsking] = useState(false)
  if (!own) {
    return <Button label={t('defaults.override')} labelKey="defaults.override" glyph={<IconPencil />} onClick={onOverride} />
  }
  return (
    <>
      <Button
        label={t('defaults.useDefault')}
        labelKey="defaults.useDefault"
        glyph={<IconRefresh />}
        onClick={() => setAsking(true)}
      />
      {asking && (
        <ConfirmDialog
          title={t('defaults.askTitle')}
          message={t('defaults.askOne', {
            setting: t(SETTING_LABEL[setting]),
            value: describeValue(inForce(defaults, setting), setting, t),
          })}
          confirmLabel={t('defaults.useDefault')}
          confirmLabelKey="defaults.useDefault"
          confirmGlyph={<IconRefresh />}
          cancelLabel={t('confirm.cancel')}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false)
            onInherit()
          }}
        />
      )}
    </>
  )
}

/** The lock before a value that comes from the defaults, with what it means in a bubble. */
export function InheritedMark() {
  const { t } = useT()
  return (
    <span className="inline-flex shrink-0 text-carbon-textMuted" data-tip={t('defaults.locked')} aria-label={t('defaults.locked')} role="img">
      <IconLock />
    </span>
  )
}

/**
 * One setting the job may take from the defaults: its name, the control, and
 * the button that overrides or goes back. While the job follows, the control
 * shows the value in force, locked.
 */
export function InheritedRow({
  label,
  hint,
  own,
  wide = false,
  action,
  children,
}: {
  label: string
  hint?: string
  own: boolean
  /** A selector, which takes the rest of the row. */
  wide?: boolean
  /** The InheritButton, or nothing for a setting another row decides. */
  action?: ReactNode
  /** The control, showing the value in force. */
  children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2" data-inherited={own ? undefined : ''}>
      <span className="flex min-w-0 flex-[1_1_12.5rem] items-center gap-1.5 text-body text-carbon-text">
        {label}
        {hint && <InfoBubble tip={hint} />}
      </span>
      <div className={`flex min-w-0 flex-wrap items-center justify-end gap-2 ${wide ? 'flex-[2_1_20rem]' : 'max-w-full'}`}>
        {!own && <InheritedMark />}
        <div inert={!own || undefined} className={`flex min-w-0 ${wide ? 'flex-1' : ''} ${own ? '' : 'opacity-45'}`}>
          {children}
        </div>
        {action}
      </div>
    </div>
  )
}
