import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { TranslationKey } from "./i18n";

// One stack per tab, so back from a detail returns to that tab's list and not
// to whatever was open in another tab.

/** What the overview opens without leaving its tab, so back returns to it. */
export type OverviewStack = {
  OverviewHome: undefined;
  Anomalies: { job?: string } | undefined;
  TrashAll: undefined;
};

export type JobsStack = {
  JobList: undefined;
  /** `check` runs the job's check as the screen opens. */
  JobDetail: { name: string; check?: boolean };
  /** No name means a new job. */
  JobEdit: { name?: string };
  Plan: { name: string };
  /** `job` opens that job's findings. */
  Anomalies: { job?: string } | undefined;
  /** `place` is the side's name, for the title. */
  Trash: { name: string; side: "left" | "right"; place: string };
};

export type ConflictsStack = {
  ConflictList: undefined;
};

export type HistoryStack = {
  /** `mode` opens a view other than the files, such as the closed findings from Anomalies. */
  RunList: { mode?: "findings" } | undefined;
};

/** The settings and the pages they open, which live behind More. */
export type SettingsStack = {
  SettingsHome: undefined;
  Language: undefined;
  /** The defaults every job starts from, visited while setting the app up. */
  Sync: undefined;
  Pairing: undefined;
};

/** The places behind More. The one picked last is the tab's first screen. */
export type MoreStack = SettingsStack & {
  TrashAll: undefined;
  TargetList: undefined;
  Instances: undefined;
  TargetPick: undefined;
  TargetEdit: { name?: string; provider?: string };
  VpnPick: undefined;
  /** A new VPN of `provider`, or the login of the one set up as `id`. */
  VpnEdit: { provider: string; id?: string };
  Anomalies: { job?: string } | undefined;
};

export type Nav<T extends Record<string, object | undefined>> = NativeStackNavigationProp<T>;

/** A place the bar holds, by the tab that shows it. */
export interface BarPlace {
  tab: "OverviewTab" | "JobsTab" | "ConflictsTab" | "HistoryTab";
  label: TranslationKey;
  glyph: string;
}

/** A place behind More, by the first screen it opens on. */
export interface MorePlace {
  screen: "TrashAll" | "TargetList" | "Instances" | "Anomalies" | "SettingsHome";
  label: TranslationKey;
  glyph: string;
}

/**
 * The phone's navigation in one table: four places on the bar and the rest in
 * the More sheet, so the bar and the sheet cannot disagree about either. While
 * the overview is switched off, Settings moves from the sheet to its place.
 */
export const BAR: BarPlace[] = [
  { tab: "OverviewTab", label: "nav.overview", glyph: "IconDashboard" },
  { tab: "JobsTab", label: "nav.jobs", glyph: "IconSync" },
  { tab: "ConflictsTab", label: "nav.conflicts", glyph: "IconConflict" },
  { tab: "HistoryTab", label: "nav.history", glyph: "IconHistory" },
];

/**
 * In the web rail's order, Settings last as the rail has it. Anomalies goes
 * while its notes are switched off, and Instances stands only while pinned.
 */
export const MORE: MorePlace[] = [
  { screen: "Anomalies", label: "nav.anomalies", glyph: "IconAnomalies" },
  { screen: "TrashAll", label: "nav.trash", glyph: "IconTrash" },
  { screen: "TargetList", label: "nav.targets", glyph: "IconTabStorage" },
  { screen: "Instances", label: "nav.instances", glyph: "IconServer" },
  { screen: "SettingsHome", label: "nav.settings", glyph: "IconGear" },
];

/** What a place on the side bar counts beside its name. */
export type RailCount = "running" | "conflicts" | "trash" | "findings";

/** A place on the side bar: a tab of its own, or a screen behind More. */
export interface RailPlace {
  key: BarPlace["tab"] | MorePlace["screen"];
  label: TranslationKey;
  glyph: string;
  go: { tab: BarPlace["tab"] } | { more: MorePlace["screen"] };
  count?: RailCount;
  /** Stands at the foot of the bar, as Settings does on the web. */
  footer: boolean;
}

/**
 * The side bar a wide window shows instead of the bar and its sheet, in the
 * web rail's order. It lists Targets always, since a wide window has no More
 * sheet to keep them in.
 */
export function railPlaces(shown: { overview: boolean; anomalies: boolean; instances: boolean }): RailPlace[] {
  const tab = (place: BarPlace, count?: RailCount): RailPlace => ({
    key: place.tab,
    label: place.label,
    glyph: place.glyph,
    go: { tab: place.tab },
    count,
    footer: false,
  });
  const more = (place: MorePlace, count?: RailCount): RailPlace => ({
    key: place.screen,
    label: place.label,
    glyph: place.glyph,
    go: { more: place.screen },
    count,
    footer: place.screen === "SettingsHome",
  });
  const bar = (name: BarPlace["tab"]) => BAR.find((b) => b.tab === name)!;
  const behind = (name: MorePlace["screen"]) => MORE.find((m) => m.screen === name)!;
  return [
    ...(shown.overview ? [tab(bar("OverviewTab"))] : []),
    tab(bar("JobsTab"), "running"),
    tab(bar("ConflictsTab"), "conflicts"),
    ...(shown.anomalies ? [more(behind("Anomalies"), "findings")] : []),
    more(behind("TrashAll"), "trash"),
    tab(bar("HistoryTab")),
    more(behind("TargetList")),
    ...(shown.instances ? [more(behind("Instances"))] : []),
    more(behind("SettingsHome")),
  ];
}

/** The place to light for the tab on screen and, on More, the screen it opened on. */
export function railCurrent(places: RailPlace[], tab: string | undefined, moreFirst: string | undefined): RailPlace["key"] | null {
  const lit = places.find((p) => ("tab" in p.go ? p.go.tab === tab : tab === "MoreTab" && p.go.more === moreFirst));
  return lit?.key ?? null;
}
