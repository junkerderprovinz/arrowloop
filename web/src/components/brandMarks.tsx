import type { ReactNode } from 'react'

import {
  IconNextcloud,
  IconOwncloud,
  IconDropbox,
  IconGooglePhotos,
  IconGoogleCloud,
  IconBox,
  IconMailru,
  IconZoho,
  IconSeafile,
  IconCitrix,
  IconBackblaze,
  IconOpenstack,
  IconAkamai,
  IconHadoop,
  IconPcloud,
  IconKoofr,
  IconJottacloud,
  IconOpendrive,
  IconPutio,
  IconSugarsync,
  IconPikpak,
  IconInternxt,
  IconUlozto,
  IconQuatrix,
  IconLinkbox,
  IconGofile,
  IconPixeldrain,
  IconAzure,
  IconFilen,
  IconFilesCom,
  IconGoogleDrive,
  IconHuawei,
  IconICloud,
  IconIonos,
  IconMega,
  IconProtonDrive,
  IconStorj,
  IconYandex,
  IconCloudinary,
  IconInternetArchive,
  IconOpencloud,
  IconOnedrive,
  IconOracleCloud,
  IconPremiumize,
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
  IconGooglePhotos: () => <IconGooglePhotos />,
  IconGoogleCloud: () => <IconGoogleCloud />,
  IconBox: () => <IconBox />,
  IconMailru: () => <IconMailru />,
  IconZoho: () => <IconZoho />,
  IconSeafile: () => <IconSeafile />,
  IconCitrix: () => <IconCitrix />,
  IconBackblaze: () => <IconBackblaze />,
  IconOpenstack: () => <IconOpenstack />,
  IconAkamai: () => <IconAkamai />,
  IconHadoop: () => <IconHadoop />,
  IconPcloud: () => <IconPcloud />,
  IconKoofr: () => <IconKoofr />,
  IconJottacloud: () => <IconJottacloud />,
  IconOpendrive: () => <IconOpendrive />,
  IconPutio: () => <IconPutio />,
  IconSugarsync: () => <IconSugarsync />,
  IconPikpak: () => <IconPikpak />,
  IconInternxt: () => <IconInternxt />,
  IconUlozto: () => <IconUlozto />,
  IconQuatrix: () => <IconQuatrix />,
  IconLinkbox: () => <IconLinkbox />,
  IconGofile: () => <IconGofile />,
  IconPixeldrain: () => <IconPixeldrain />,
  IconAzure: () => <IconAzure />,
  IconFilen: () => <IconFilen />,
  IconFilesCom: () => <IconFilesCom />,
  IconGoogleDrive: () => <IconGoogleDrive />,
  IconHuawei: () => <IconHuawei />,
  IconICloud: () => <IconICloud />,
  IconIonos: () => <IconIonos />,
  IconMega: () => <IconMega />,
  IconProtonDrive: () => <IconProtonDrive />,
  IconStorj: () => <IconStorj />,
  IconYandex: () => <IconYandex />,
  IconCloudinary: () => <IconCloudinary />,
  IconInternetArchive: () => <IconInternetArchive />,
  IconOpencloud: () => <IconOpencloud />,
  IconOnedrive: () => <IconOnedrive />,
  IconOracleCloud: () => <IconOracleCloud />,
  IconPremiumize: () => <IconPremiumize />,
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
