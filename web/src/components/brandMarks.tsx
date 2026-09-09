import type { ReactNode } from 'react'

import {
  IconNextcloud,
  IconOwncloud,
  IconDropbox,
  IconGoogleDrive,
  IconGooglePhotos,
  IconGoogleCloud,
  IconMega,
  IconBox,
  IconProtonDrive,
  IconICloud,
  IconMailru,
  IconYandex,
  IconZoho,
  IconSeafile,
  IconFilen,
  IconFilesCom,
  IconHuawei,
  IconIonos,
  IconCitrix,
  IconBackblaze,
  IconOpenstack,
  IconAkamai,
  IconHadoop,
  IconInternetArchive,
  IconCloudinary,
  IconOpencloud,
} from './brandGlyphs'
import {
  IconFolder,
  IconTargets,
  IconLink,
  IconHidden,
} from './glyphs'

/**
 * A provider's mark by the name the server sends, or undefined.
 *
 * TWO sources on purpose. The brand marks are somebody else's drawings in
 * somebody else's colours, and must not be redrawn to fit. The protocol marks
 * are this app's own glyphs, because there is no company behind "SFTP" to have
 * a logo - and a tile with an empty square beside its neighbours reads as a
 * missing image rather than as "this one has no logo".
 *
 * A lookup rather than a switch, and the KEY is what the Go table wrote down:
 * `remotes.Provider.Mark`. So a provider gains a mark by one line in one Go
 * file, and one whose mark this build does not carry falls back rather than
 * failing.
 */
const MARKS: Record<string, () => ReactNode> = {
  IconNextcloud: () => <IconNextcloud />,
  IconOwncloud: () => <IconOwncloud />,
  IconDropbox: () => <IconDropbox />,
  IconGoogleDrive: () => <IconGoogleDrive />,
  IconGooglePhotos: () => <IconGooglePhotos />,
  IconGoogleCloud: () => <IconGoogleCloud />,
  IconMega: () => <IconMega />,
  IconBox: () => <IconBox />,
  IconProtonDrive: () => <IconProtonDrive />,
  IconICloud: () => <IconICloud />,
  IconMailru: () => <IconMailru />,
  IconYandex: () => <IconYandex />,
  IconZoho: () => <IconZoho />,
  IconSeafile: () => <IconSeafile />,
  IconFilen: () => <IconFilen />,
  IconFilesCom: () => <IconFilesCom />,
  IconHuawei: () => <IconHuawei />,
  IconIonos: () => <IconIonos />,
  IconCitrix: () => <IconCitrix />,
  IconBackblaze: () => <IconBackblaze />,
  IconOpenstack: () => <IconOpenstack />,
  IconAkamai: () => <IconAkamai />,
  IconHadoop: () => <IconHadoop />,
  IconInternetArchive: () => <IconInternetArchive />,
  IconCloudinary: () => <IconCloudinary />,
  IconOpencloud: () => <IconOpencloud />,
  IconFolder: () => <IconFolder className="text-carbon-textSub" />,
  IconTargets: () => <IconTargets className="text-carbon-textSub" />,
  IconLink: () => <IconLink className="text-carbon-textSub" />,
  IconHidden: () => <IconHidden className="text-carbon-textSub" />,
}

export function brandMark(name: string | undefined): ReactNode | undefined {
  if (!name) return undefined
  const make = MARKS[name]
  return make ? make() : undefined
}
