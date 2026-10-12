import { ExcludeSetEditor, type Sets } from '../../components/ExcludeSets'
import { Stack } from '../../components/Shell'
import { Card } from '../../lib/glimstone/Card'
import { useT } from '../../lib/i18n'
import { Reading, useEngineSettings } from './engineSettings'

/** Named lists of patterns that several jobs can leave out by one name. */
export function ExcludePage() {
  const { t } = useT()
  const { loaded, draft, patch, error } = useEngineSettings()
  if (!loaded) return <Reading title={t('engine.sets')} error={error} />

  return (
    <Stack>
      <Card title={t('engine.sets')} hint={t('engine.setsHint')} hueIndex={0}>
        <ExcludeSetEditor
          sets={(draft.excludeSets as Sets | undefined) ?? {}}
          onChange={(next) => patch({ excludeSets: next })}
        />
      </Card>
    </Stack>
  )
}
