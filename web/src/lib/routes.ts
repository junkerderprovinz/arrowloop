// Every address the interface answers, and where a retired one leads instead.

import type { NavPins } from './navPins'

/** The settings tiles in their column's order, Info last. */
export const TILE_IDS = [
  'general',
  'look',
  'sync',
  'workload',
  'safety',
  'notifications',
  'exclude',
  'targets',
  'anomalies',
  'security',
  'app',
  'info',
] as const

export type TileId = (typeof TILE_IDS)[number]

/** The pages that are settings tiles and, when pinned, sidebar entries too. */
export type ModuleId = 'targets' | 'anomalies'

/** Tiles that were renamed or split, so a bookmark to the old address still lands. */
export const FORMER_TILES: Record<string, TileId> = { engine: 'sync' }

export type View =
  | { page: 'jobs' | 'conflicts' | 'trash' | 'history' | 'welcome' }
  | { page: 'job'; name: string }
  | { page: ModuleId }
  | { page: 'settings'; tile: TileId }

/** `wait` holds an address back until the engine has said what it leads to. */
export type Resolved = { view: View } | { redirect: string } | { wait: true }

export interface RouteContext {
  pins: NavPins
  /** The tiles this build offers, in order. */
  tiles: readonly TileId[]
  /** The tile that was open last in this browser. */
  remembered: string | null
  /** Whether this is the first start, with no job yet; null until the jobs are read. */
  fresh?: boolean | null
}

const MODULES: readonly string[] = ['targets', 'anomalies']

export function resolveRoute(pathname: string, search: URLSearchParams, ctx: RouteContext): Resolved {
  const query = search.toString() ? `?${search}` : ''
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const [first, second, third] = parts

  switch (first) {
    case undefined:
      if (ctx.fresh === null) return { wait: true }
      return { redirect: ctx.fresh ? '/welcome' : '/jobs' }
    case 'welcome':
      return parts.length === 1 ? { view: { page: 'welcome' } } : { redirect: '/welcome' }
    case 'jobs':
      if (parts.length === 1) return { view: { page: 'jobs' } }
      if (parts.length === 2 && second) return { view: { page: 'job', name: second } }
      // The preview is a card on the job's page.
      if (parts.length === 3 && second && third === 'preview') return { redirect: `/jobs/${encodeURIComponent(second)}` }
      return { redirect: '/jobs' }
    case 'conflicts':
    case 'trash':
    case 'history':
      return parts.length === 1 ? { view: { page: first } } : { redirect: `/${first}${query}` }
    case 'settings':
      return settings(second, parts.length, query, ctx)
  }
  if (MODULES.includes(first) && parts.length === 1) {
    const id = first as ModuleId
    // An unpinned page lives on its tile, so its own address leads there.
    return ctx.pins[id] ? { view: { page: id } } : { redirect: `/settings/${id}${query}` }
  }
  return { redirect: '/jobs' }
}

function settings(tile: string | undefined, depth: number, query: string, ctx: RouteContext): Resolved {
  const offered = (id: string | null | undefined): id is TileId => !!id && (ctx.tiles as readonly string[]).includes(id)
  const first = ctx.tiles[0] ?? 'general'
  if (tile === undefined) {
    return { redirect: `/settings/${offered(ctx.remembered) ? ctx.remembered : first}` }
  }
  if (depth === 2 && offered(tile)) return { view: { page: 'settings', tile } }
  const moved = FORMER_TILES[tile]
  if (moved && offered(moved)) return { redirect: `/settings/${moved}${query}` }
  return { redirect: `/settings/${first}` }
}

/** The address of a page another screen narrows to one job, and on Anomalies to one finding. */
export function jobPlace(page: 'jobs' | 'conflicts' | 'trash' | 'anomalies', job: string, finding?: string): string {
  const query = [job && `job=${encodeURIComponent(job)}`, finding && `finding=${encodeURIComponent(finding)}`].filter(Boolean)
  return query.length ? `/${page}?${query.join('&')}` : `/${page}`
}
