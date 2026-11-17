import type { TranslationKey } from "./i18n";
import type { MoreStack } from "./nav";

export type TileId = "general" | "look" | "sync" | "targets" | "pairing" | "apps" | "info";

/**
 * A page of the settings as the web's tiles divide them. A tile whose web page
 * is a screen of its own on the phone shows that `screen` beside the tiles.
 */
export interface SettingsTile {
  id: TileId;
  label: TranslationKey;
  glyph: string;
  screen?: keyof MoreStack;
}

const TILES: SettingsTile[] = [
  { id: "general", label: "settings.general", glyph: "IconTabGeneral" },
  { id: "look", label: "settings.look", glyph: "IconTabLook" },
  { id: "sync", label: "settings.sync", glyph: "IconSync", screen: "Sync" },
  { id: "targets", label: "nav.targets", glyph: "IconTabStorage", screen: "TargetList" },
  { id: "pairing", label: "settings.pairing", glyph: "IconLink", screen: "Pairing" },
  { id: "apps", label: "settings.apps", glyph: "IconTabApp" },
  { id: "info", label: "settings.info", glyph: "IconInfo" },
];

/**
 * The tiles a wide window shows beside the settings, in the web's order. The
 * web's Safety and Security have no phone counterpart: the phone's lock sits
 * with the phone's other permissions under General.
 */
export function settingsTiles(can: { pairable: boolean }): SettingsTile[] {
  return TILES.filter((tile) => tile.id !== "pairing" || can.pairable);
}

/** The cards of the phone's settings page, in the order a phone shows them. */
export type SectionId =
  | "language"
  | "sync"
  | "pairing"
  | "thisPhone"
  | "appearance"
  | "motion"
  | "engine"
  | "backup"
  | "server"
  | "desktop"
  | "problems"
  | "about"
  | "danger";

/**
 * The tile each card goes to, where the web keeps the same thing: the language
 * with the look, as on the web's Look tile, and the danger zone with what
 * concerns the app as a whole.
 */
export const SECTION_TILE: Record<SectionId, TileId> = {
  language: "look",
  sync: "sync",
  pairing: "pairing",
  thisPhone: "general",
  appearance: "look",
  motion: "look",
  engine: "general",
  backup: "general",
  server: "apps",
  desktop: "apps",
  problems: "info",
  about: "info",
  danger: "general",
};
