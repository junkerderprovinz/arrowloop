import { OtherInstances } from '../components/OtherInstances'
import { Empty } from '../components/Shell'
import { Card } from '../lib/glimstone/Card'
import { useT } from '../lib/i18n'

/** The other instances of the group with their jobs, the page the sidebar leads to once it is pinned. */
export function Instances() {
  const { t } = useT()
  return (
    <OtherInstances
      firstHue={0}
      empty={
        <Card title={t('nav.instances')} hueIndex={0}>
          <Empty>{t('instances.none')}</Empty>
        </Card>
      }
    />
  )
}
