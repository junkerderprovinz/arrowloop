import { Fragment, isValidElement, type ReactElement, type ReactNode } from 'react'
import { isTileMark, type TileMark } from '@glimstone/core'

import {
  BRAND_TILES,
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
  IconHuaweiCloud,
  IconICloud,
  IconIonos,
  IconMega,
  IconProtonDrive,
  IconStorj,
  IconYandex,
  IconCloudinary,
  IconInternetArchive,
  IconOpencloud,
  IconDosya,
  IconKdrive,
  IconOnedrive,
  IconOracleCloud,
  IconWasabi,
  IconCloudflare,
  IconDigitalOcean,
  IconScaleway,
  IconHetzner,
  IconOvh,
  IconSynology,
  IconMinio,
  IconLinode,
  IconIdrive,
  IconSeaweedfs,
  IconCeph,
  IconGarage,
  IconDoi,
  IconPremiumize,
  IconDrime,
  IconFilelu,
  IconShade,
  IconImagekit,
  IconQingcloud,
  IconSia,
  IconFichier,
} from './brandGlyphs'
import {
  IconAdd,
  IconBuckets,
  IconCheck,
  IconCopy,
  IconDiagnostics,
  IconDownload,
  IconFolder,
  IconLink,
  IconLock,
  IconRefresh,
  IconServer,
  IconSync,
  IconTabStorage,
  IconTransfer,
} from './glyphs'

/**
 * Provider marks keyed by `remotes.Provider.Mark` from the Go table. Brands
 * keep their own drawings and colours; protocols such as SFTP get the app's
 * own glyphs in the colour of the text around them, so a lit tile can turn
 * them its ink. An unknown key yields no mark.
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
  IconWasabi: () => <IconWasabi />,
  IconCloudflare: () => <IconCloudflare />,
  IconDigitalOcean: () => <IconDigitalOcean />,
  IconScaleway: () => <IconScaleway />,
  IconHetzner: () => <IconHetzner />,
  IconOvh: () => <IconOvh />,
  IconSynology: () => <IconSynology />,
  IconMinio: () => <IconMinio />,
  IconLinode: () => <IconLinode />,
  IconIdrive: () => <IconIdrive />,
  IconSeaweedfs: () => <IconSeaweedfs />,
  IconCeph: () => <IconCeph />,
  IconGarage: () => <IconGarage />,
  IconQuatrix: () => <IconQuatrix />,
  IconLinkbox: () => <IconLinkbox />,
  IconGofile: () => <IconGofile />,
  IconPixeldrain: () => <IconPixeldrain />,
  IconAzure: () => <IconAzure />,
  IconFilen: () => <IconFilen />,
  IconFilesCom: () => <IconFilesCom />,
  IconGoogleDrive: () => <IconGoogleDrive />,
  IconHuaweiCloud: () => <IconHuaweiCloud />,
  IconICloud: () => <IconICloud />,
  IconIonos: () => <IconIonos />,
  IconMega: () => <IconMega />,
  IconProtonDrive: () => <IconProtonDrive />,
  IconStorj: () => <IconStorj />,
  IconYandex: () => <IconYandex />,
  IconCloudinary: () => <IconCloudinary />,
  IconInternetArchive: () => <IconInternetArchive />,
  IconOpencloud: () => <IconOpencloud />,
  IconDosya: () => <IconDosya />,
  IconKdrive: () => <IconKdrive />,
  IconOnedrive: () => <IconOnedrive />,
  IconOracleCloud: () => <IconOracleCloud />,
  IconDoi: () => <IconDoi />,
  IconPremiumize: () => <IconPremiumize />,
  IconDrime: () => <IconDrime />,
  IconFilelu: () => <IconFilelu />,
  IconShade: () => <IconShade />,
  IconImagekit: () => <IconImagekit />,
  IconQingcloud: () => <IconQingcloud />,
  IconSia: () => <IconSia />,
  IconFichier: () => <IconFichier />,
  IconAdd: () => <IconAdd />,
  IconBuckets: () => <IconBuckets />,
  IconCheck: () => <IconCheck />,
  IconCopy: () => <IconCopy />,
  IconDiagnostics: () => <IconDiagnostics />,
  IconDownload: () => <IconDownload />,
  IconFolder: () => <IconFolder />,
  IconLink: () => <IconLink />,
  IconLock: () => <IconLock />,
  IconRefresh: () => <IconRefresh />,
  IconServer: () => <IconServer />,
  IconSync: () => <IconSync />,
  IconTabStorage: () => <IconTabStorage />,
  IconTransfer: () => <IconTransfer />,
}

export function brandMark(name: string | undefined): ReactNode | undefined {
  if (!name) return undefined
  const make = MARKS[name]
  return make ? make() : undefined
}

/**
 * A provider's mark in the form GlimStone's picker takes: a brand as markup
 * with the colours its tile lights up in, one of the app's glyphs as it is.
 */
export function pickMark(name: string | undefined): TileMark | ReactNode | undefined {
  const mark = brandMark(name)
  const lit = name ? BRAND_TILES[name] : undefined
  return lit && isValidElement(mark) ? tileMark(mark, lit) : mark
}

const markups = new Map<unknown, string>()

/** A brand mark as markup, lit in its brand's colours. */
export function tileMark(mark: ReactElement, lit: { tile: string; ink: string }): TileMark {
  let svg = markups.get(mark.type)
  if (svg === undefined) {
    svg = markup(mark)
    markups.set(mark.type, svg)
  }
  return { svg, ...lit }
}

/**
 * A tile's mark with the What's new dot of `id` on it. A picker's tiles take
 * no attributes, and the dots only stand on HTML elements, not on an <svg>.
 */
export function newOnMark(mark: TileMark | ReactNode, id: string | undefined): TileMark | ReactNode {
  if (!id) return mark
  if (isTileMark(mark)) return { ...mark, svg: `<span data-new="${id}" style="display:flex">${mark.svg}</span>` }
  return (
    <span data-new={id} className="flex">
      {mark}
    </span>
  )
}

// SVG's own camelCase attributes. React spells every hyphenated one in
// camelCase as well, so only these keep their capitals in the markup.
const CAMEL = new Set([
  'viewBox',
  'preserveAspectRatio',
  'gradientUnits',
  'gradientTransform',
  'patternUnits',
  'patternContentUnits',
  'patternTransform',
  'maskUnits',
  'maskContentUnits',
  'clipPathUnits',
  'spreadMethod',
  'stdDeviation',
  'pathLength',
  'markerWidth',
  'markerHeight',
  'markerUnits',
  'refX',
  'refY',
  'filterUnits',
  'primitiveUnits',
])

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
const quoted = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function attribute(key: string, value: unknown): string {
  if (key === 'className') return `class="${quoted(String(value))}"`
  if (key === 'xlinkHref') return `xlink:href="${quoted(String(value))}"`
  if (key === 'style') {
    const rules = Object.entries(value as Record<string, string>).map(([k, v]) => `${kebab(k)}:${v}`)
    return `style="${quoted(rules.join(';'))}"`
  }
  return `${CAMEL.has(key) || key.includes('-') ? key : kebab(key)}="${quoted(String(value))}"`
}

/**
 * Writes a generated mark out as SVG markup. The marks are plain functions of
 * their props with no state, so calling one gives the elements React would
 * draw. They hold no text.
 */
function markup(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(markup).join('')
  if (!isValidElement(node)) return ''
  const { type, props } = node as ReactElement<Record<string, unknown>>
  if ((type as unknown) === Fragment) return markup(props.children as ReactNode)
  if (typeof type === 'function') return markup((type as (p: object) => ReactNode)(props))
  const attrs = Object.entries(props)
    .filter(([key, value]) => key !== 'children' && value !== undefined && value !== null && value !== false)
    .map(([key, value]) => ` ${attribute(key, value)}`)
    .join('')
  return `<${type as string}${attrs}>${markup(props.children as ReactNode)}</${type as string}>`
}
