import { useEffect, useState } from 'react'

import { api, type Job } from './api'
import { useT, type TranslationKey } from './i18n'
import { useLive } from './live'
import { useToast } from './toast'

/**
 * The button that starts a job or stops its run. A stop takes a moment to
 * wind down, and until the run is over the button says so instead of offering
 * the stop again.
 */
export function useStartStop(job: Job, onStarted?: () => void) {
  const { t } = useT()
  const push = useToast()
  const live = useLive()
  const [stopping, setStopping] = useState(false)
  useEffect(() => {
    if (!job.running) setStopping(false)
  }, [job.running])

  const labelKey: TranslationKey = stopping ? 'jobs.stopping' : job.running ? 'jobs.cancelRun' : 'jobs.runNow'
  const press = () => {
    if (!job.running) {
      // The engine announces a run once it has a slot, which can be after
      // another run ends, so the job list is asked at once.
      api.run(job.name).then(onStarted ?? live.onSaved, (e: Error) => push(e.message, 'fail'))
      return
    }
    setStopping(true)
    api
      .stopJob(job.name)
      .then(({ stopped }) => {
        // It had finished already, and the list has not heard yet.
        if (!stopped) live.onSaved()
      })
      .catch((e: Error) => {
        setStopping(false)
        push(e.message, 'fail')
      })
  }
  return {
    label: t(labelKey),
    labelKey,
    hint: job.running ? undefined : t('jobs.runNowHint'),
    disabled: stopping,
    press,
  }
}
