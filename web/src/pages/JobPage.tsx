import { Card } from '../lib/glimstone/Card'

/** One job's own page, at /jobs/<name>. */
export function JobPage({ name }: { name: string }) {
  return (
    <Card title={name} hueIndex={0}>
      <p className="text-subline text-carbon-textMuted">{name}</p>
    </Card>
  )
}
