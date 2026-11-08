import type { RelayConfig, RelayMode } from '../../../lib/api'

/**
 * The routes the relay card offers. The engine stores three modes and a
 * switch, and "instance" is an own relay that a paired ArrowLoop serves.
 */
export type RelayForm = RelayMode | 'instance'

/** The four routes in the order the picker shows them, as in BombVault. */
export const FORMS: RelayForm[] = ['project', 'own', 'instance', 'off']

/** Where an ArrowLoop answers the instances that use it as their relay. */
const SERVE_PATH = '/relay/connect'

function atServePath(url: string): boolean {
  try {
    return new URL(url.trim()).pathname.replace(/\/+$/, '') === SERVE_PATH
  } catch {
    return false
  }
}

/**
 * relayForm tells the two kinds of own relay apart without a stored choice:
 * this instance serving one, or an address at the path an instance serves its
 * relay under, means an ArrowLoop is the relay.
 */
export function relayForm(relay: Pick<RelayConfig, 'mode' | 'relayUrl' | 'serve'>): RelayForm {
  if (relay.mode !== 'own') return relay.mode
  return relay.serve || atServePath(relay.relayUrl) ? 'instance' : 'own'
}

/** The mode the engine stores for a route. */
export function modeOf(form: RelayForm): RelayMode {
  return form === 'instance' ? 'own' : form
}
