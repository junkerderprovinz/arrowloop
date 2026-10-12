import { useEffect, useState } from 'react'

import { Dialog } from './Dialog'
import { IconClose, IconSave } from './glyphs'
import { Button } from '../lib/glimstone/Button'
import type { RawJob } from '../lib/api'
import { useT } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { JobForm, useJobConfig } from '../pages/Editor'

export type JobConfig = ReturnType<typeof useJobConfig>

/**
 * A job's settings in a window, with Save as its main button. Cancel puts the
 * entry back as it was, and drops a job that was only just added.
 */
export function JobEditor({
  config,
  at,
  added,
  onClose,
}: {
  config: JobConfig
  /** The entry's place in the configuration. */
  at: number
  /** A job made for this window, which Cancel takes away again. */
  added: boolean
  onClose: () => void
}) {
  const { t } = useT()
  const [original] = useState<RawJob | undefined>(() => config.jobs?.[at])
  // Counts refused saves, so each one remounts the button and shakes it again.
  const [refused, setRefused] = useState(0)
  const job = config.jobs?.[at]

  function cancel() {
    if (added) void config.remove(at, false)
    else if (original) config.replace(at, original)
    onClose()
  }

  if (!job) return null
  return (
    <Dialog
      title={added ? t('job.new') : t('job.editTitle', { name: original?.name || t('edit.unnamed') })}
      onClose={cancel}
      closeOnBackdrop={false}
      wide
      footer={
        <>
          <Button label={t('confirm.cancel')} labelKey="confirm.cancel" glyph={<IconClose />} onClick={cancel} />
          <Button
            key={refused}
            label={config.busy ? t('edit.checking') : t('edit.save')}
            labelKey={config.busy ? 'edit.checking' : 'edit.save'}
            glyph={<IconSave />}
            tone="accent"
            busy={config.busy}
            disabled={config.busy}
            className={refused > 0 ? 'glim-shake' : ''}
            onClick={() => {
              void config.save().then((ok) => {
                if (ok) onClose()
                else setRefused((n) => n + 1)
              })
            }}
          />
        </>
      }
    >
      <JobForm job={job} known={config.known} defaults={config.defaults} patch={(next) => config.patch(at, next)} />
    </Dialog>
  )
}

/** Reports what the configuration refused as a toast, the one place failures are told. */
export function useConfigErrors(config: JobConfig) {
  const push = useToast()
  useEffect(() => {
    if (config.error) push(config.error, 'fail')
  }, [config.error, push])
}
