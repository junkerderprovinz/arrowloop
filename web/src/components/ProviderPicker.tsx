import type { ReactNode } from 'react'
import { PickerWindow, type PickerItem } from '@glimstone/react/PickerWindow'
import type { WindowAction } from '@glimstone/react/Window'

import { newOnMark, pickMark } from './brandMarks'
import { useT, type TranslationKey } from '../lib/i18n'
import { providerHint, providerName } from '../lib/optionHint'
import type { Backend, Provider } from '../lib/api'

/** The rows whose mark a What's new entry points at, by provider id. */
const NEW_MARKS: Record<string, string> = { synologyc2: 'provider-marks', filefabric: 'provider-marks' }

/**
 * The picker's groups. A target built on another one has a group of its own
 * here, and once saved it sits among the servers and shares. The compiled-in
 * backends no provider entry covers come last, by their rclone names, since
 * few people look for a protocol that way.
 */
const GROUPS: Record<string, TranslationKey> = {
  cloud: 'targets.cloud',
  storage: 'targets.storage',
  protocol: 'targets.connections',
  layered: 'targets.layered',
}
const UNLISTED = 'unlisted'

/**
 * Picks what a target connects to by product name rather than by protocol,
 * then shows the picked one's form in the same window. A brand lights up in
 * its colour from BRAND_TILES, a protocol wears one of the app's own glyphs
 * and lights up in the accent. The search finds a product by the name shown
 * and by rclone's own, which is what a guide online calls it.
 */
export function ProviderPicker({
  providers,
  unlisted,
  onPick,
  form,
  actions,
  onBack,
  onClose,
}: {
  providers: Provider[]
  /** Compiled-in backends no provider entry covers, offered after the list. */
  unlisted: Backend[]
  /**
   * The whole provider, so the form can name the target after the product and
   * explain its address shape. An unlisted backend arrives as its bare name.
   */
  onPick: (picked: Provider | string) => void
  /** The picked provider's form, which takes the tiles' place. */
  form?: ReactNode
  actions?: WindowAction[]
  onBack?: () => void
  onClose: () => void
}) {
  const { t } = useT()
  const items: PickerItem[] = [
    ...providers.map((p) => ({
      id: p.id,
      label: providerName(p, t),
      mark: newOnMark(pickMark(p.mark), NEW_MARKS[p.id]),
      group: p.group,
      hint: providerHint(p.id, t),
      terms: [p.name, p.backend],
    })),
    ...unlisted.map((b) => ({ id: b.name, label: b.name, group: UNLISTED })),
  ]
  const groups = [
    ...Object.entries(GROUPS).map(([id, title]) => ({ id, title: t(title) })),
    { id: UNLISTED, title: t('targets.pickMore', { count: unlisted.length }) },
  ]
  const name = (id: string, fallback: string) => {
    const p = providers.find((x) => x.id === id)
    return p ? providerName(p, t) : fallback
  }

  return (
    <PickerWindow
      title={t('targets.addStorage')}
      hint={t('targets.addStorageHint')}
      items={items}
      groups={groups}
      text={{
        search: t('targets.search'),
        none: t('targets.searchNone', { s3: name('s3', 'S3'), webdav: name('webdav', 'WebDAV') }),
        close: t('common.close'),
        cancel: t('targets.cancel'),
        back: t('preview.back'),
      }}
      onPick={(id) => onPick(providers.find((p) => p.id === id) ?? id)}
      actions={actions}
      onBack={onBack}
      onClose={onClose}
    >
      {form}
    </PickerWindow>
  )
}
