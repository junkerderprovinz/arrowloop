// The notification settings as the engine stores them under `notify`.
// internal/job/job.go holds the same rules.

export type When = 'never' | 'failure' | 'always'

export type Channel = 'webhook' | 'matrix' | 'smtp' | 'apprise' | 'healthchecks'

/**
 * Every channel has an `enabled` switch. A file without it predates the
 * switch, and a channel filled in there was meant to send, so undefined counts
 * as on once the channel has what it needs.
 */
export type Notify = {
  on?: When
  /** How an older file says `always`; `on` decides when both are set. */
  onSuccess?: boolean
  webhook?: string
  webhookFormat?: string
  webhookEnabled?: boolean
  matrix?: { enabled?: boolean; homeserver: string; room: string; token: string }
  smtp?: {
    enabled?: boolean
    host?: string
    port?: number
    username?: string
    password?: string
    from?: string
    /** Several addresses, separated by commas or semicolons. */
    to?: string
    tls?: string
  }
  apprise?: { enabled?: boolean; url?: string; tags?: string }
  /** `jobs` gives a job a check of its own, by job name. */
  healthchecks?: { enabled?: boolean; url?: string; jobs?: Record<string, string> }
}

/** When a message goes out, with the older onSuccess read as the engine reads it. */
export function notifyWhen(n: Notify): When {
  if (n.on) return n.on
  return n.onSuccess ? 'always' : 'failure'
}

/** Whether a channel is switched on, as the engine decides it for a file without the switch. */
export function channelOn(n: Notify, channel: Channel): boolean {
  switch (channel) {
    case 'webhook':
      return n.webhookEnabled ?? !!n.webhook
    case 'matrix':
      return n.matrix?.enabled ?? !!(n.matrix?.homeserver && n.matrix.room && n.matrix.token)
    case 'smtp':
      return n.smtp?.enabled ?? !!(n.smtp?.host && n.smtp.from && n.smtp.to)
    case 'apprise':
      return n.apprise?.enabled ?? !!n.apprise?.url
    case 'healthchecks':
      return n.healthchecks?.enabled ?? !!(n.healthchecks?.url || Object.values(n.healthchecks?.jobs ?? {}).some(Boolean))
  }
}
