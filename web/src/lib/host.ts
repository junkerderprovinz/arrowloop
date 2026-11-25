import { createContext, useContext } from 'react'

import { api, type FolderListing, type RawJob, type Settings } from './api'

/**
 * The instance a job form edits: where its folder picker walks and which
 * shared lists it offers. This one by default; a job of another instance of
 * the group names that instance, lists its folders through the relay and makes
 * none there.
 */
export type Host = {
  /** The other instance's name, undefined for this one. */
  name?: string
  /** Lists one folder, its hidden folders too when hidden is set. */
  browse: (path?: string, hidden?: boolean) => Promise<FolderListing>
  makeDir?: (parent: string, name: string) => Promise<{ path: string }>
  excludeSets: () => Promise<string[]>
  /** The shared lists with every job, where this instance lets them be edited. */
  sharedLists?: () => Promise<SharedLists>
  saveSharedLists?: (sets: Record<string, string[]>) => Promise<void>
}

export type SharedLists = { sets: Record<string, string[]>; jobs: RawJob[] }

const sharedLists = () =>
  api.settings().then((s: Settings) => (s.excludeSets as Record<string, string[]> | undefined) ?? {})

export const THIS_HOST: Host = {
  browse: (path, hidden) => api.browse(path, hidden),
  makeDir: (parent, name) => api.makeDir(parent, name),
  excludeSets: () => sharedLists().then((sets) => Object.keys(sets).sort()),
  sharedLists: () => Promise.all([sharedLists(), api.config()]).then(([sets, config]) => ({ sets, jobs: config.jobs })),
  saveSharedLists: (sets) => api.saveSettings({ excludeSets: sets }).then(() => undefined),
}

/** A job of instance id, called name, whose shared lists are already known by name. */
export function otherHost(id: string, name: string, excludeSets: string[]): Host {
  return {
    name,
    browse: (path, hidden) => api.browseOnInstance(id, path, hidden),
    excludeSets: () => Promise.resolve(excludeSets),
  }
}

export const HostContext = createContext<Host>(THIS_HOST)

export function useHost() {
  return useContext(HostContext)
}
