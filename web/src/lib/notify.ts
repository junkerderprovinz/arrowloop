// The notification channels as the engine stores them under `notify`, in the
// format of the kit's notify package (parleyport/kit/notify).

export type When = 'never' | 'failure' | 'always'

export const KINDS = ['discord', 'slack', 'ntfy', 'gotify', 'matrix', 'smtp', 'apprise', 'webhook', 'healthchecks'] as const

export type Kind = (typeof KINDS)[number]

export type Channel = {
  id: string
  kind: Kind
  name?: string
  enabled: boolean
  on?: When
  events?: string[]
  attempts?: number
  timeoutSeconds?: number
  webhook?: { url: string; method?: string; headers?: Record<string, string>; body?: string }
  discord?: { url: string }
  slack?: { url: string }
  gotify?: { url: string; token?: string; priorityFailure?: number; prioritySuccess?: number }
  ntfy?: { url: string; token?: string }
  matrix?: { homeserver: string; room: string; token: string }
  smtp?: {
    host: string
    port?: number
    username?: string
    password?: string
    from: string
    /** Several addresses, separated by commas or semicolons. */
    to: string
    tls?: string
  }
  /** Without urls, url is a key's endpoint; with them, the stateless /notify. */
  apprise?: { url: string; urls?: string[]; tags?: string }
  /** byKey gives a job a check of its own, by job name. */
  healthchecks?: { url?: string; byKey?: Record<string, string> }
}

export type Notify = { channels?: Channel[] }

/** What a new webhook posts: the same document a webhook from an older file keeps. */
const WEBHOOK_BODY = '{"subject":"%%title%%","body":"%%body%%","ok":%%ok%%}'

/** A channel of one service, switched on and still empty, under an id no other channel has. */
export function newChannel(kind: Kind, channels: Channel[]): Channel {
  const taken = new Set(channels.map((c) => c.id))
  let id: string = kind
  for (let n = 2; taken.has(id); n++) id = `${kind}-${n}`
  const c: Channel = { id, kind, enabled: true, on: kind === 'healthchecks' ? 'always' : 'failure' }
  switch (kind) {
    case 'webhook':
      return { ...c, webhook: { url: '', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: WEBHOOK_BODY } }
    case 'matrix':
      return { ...c, matrix: { homeserver: '', room: '', token: '' } }
    case 'smtp':
      return { ...c, smtp: { host: '', from: '', to: '' } }
    case 'healthchecks':
      return { ...c, healthchecks: {} }
    default:
      return { ...c, [kind]: { url: '' } }
  }
}

/** Whether a channel sends anything at all. A check pings every run unless its when is never. */
export function sends(c: Channel): boolean {
  return c.enabled && c.on !== 'never'
}
