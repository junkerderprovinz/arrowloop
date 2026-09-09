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
} from './brandGlyphs'

/**
 * A provider's logo by the name the server sends, or undefined.
 *
 * A lookup rather than a switch, and the KEY is what the Go table wrote down:
 * `remotes.Provider.Mark`. So a provider gains a logo by one line in one Go
 * file, and a provider whose mark this build does not carry falls back to a
 * generic glyph instead of failing.
 *
 * Undefined is a real answer and a common one: several providers deliberately
 * have no mark, because the CC0 set carries none for them and a logo naming the
 * WRONG service is worse than none at all.
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
}

export function brandMark(name: string | undefined): ReactNode | undefined {
  if (!name) return undefined
  const make = MARKS[name]
  return make ? make() : undefined
}
