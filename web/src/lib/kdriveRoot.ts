// kDrive's root folder as one choice. rclone takes private or common for the
// two folders every drive has, and the ID of any other folder.

export type KdriveRoot = 'private' | 'common' | 'id'

export const KDRIVE_ROOTS: KdriveRoot[] = ['private', 'common', 'id']

/** The choice a saved root_folder_id stands for. Empty is rclone's default, the private folder. */
export function kdriveRoot(value: string): KdriveRoot {
  const v = value.trim()
  if (v === '' || v === 'private') return 'private'
  if (v === 'common') return 'common'
  return 'id'
}

/**
 * The root_folder_id a choice saves. Picking a folder by ID starts empty, so
 * the shortcut picked before is not taken for an ID.
 */
export function kdriveRootValue(mode: KdriveRoot): string {
  return mode === 'id' ? '' : mode
}
