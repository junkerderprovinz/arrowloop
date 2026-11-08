import { createContext, useContext } from 'react'

import { api, type FolderListing, type Settings } from './api'

/**
 * The instance a job form edits: where its folder picker walks and which
 * exclude sets it offers. This one by default; a job of another instance of
 * the group names that instance, lists its folders through the relay and makes
 * none there.
 */
export type Host = {
  /** The other instance's name, undefined for this one. */
  name?: string
  browse: (path?: string) => Promise<FolderListing>
  makeDir?: (parent: string, name: string) => Promise<{ path: string }>
  excludeSets: () => Promise<string[]>
}

export const THIS_HOST: Host = {
  browse: (path) => api.browse(path),
  makeDir: (parent, name) => api.makeDir(parent, name),
  excludeSets: () =>
    api.settings().then((s: Settings) => Object.keys((s.excludeSets as Record<string, string[]> | undefined) ?? {}).sort()),
}

/** A job of instance id, called name, whose exclude sets are already known. */
export function otherHost(id: string, name: string, excludeSets: string[]): Host {
  return {
    name,
    browse: (path) => api.browseOnInstance(id, path),
    excludeSets: () => Promise.resolve(excludeSets),
  }
}

export const HostContext = createContext<Host>(THIS_HOST)

export function useHost() {
  return useContext(HostContext)
}
