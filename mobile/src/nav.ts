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
  JobDetail: { name: string };
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
  RunList: undefined;
};

/** The settings and the pages they open, which live behind More. */
export type SettingsStack = {
  SettingsHome: undefined;
  Language: undefined;
  /** The defaults every job starts from, visited while setting the app up. */
  Sync: undefined;
};

/** The places behind More. The one picked last is the tab's first screen. */
export type MoreStack = SettingsStack & {
  TrashAll: undefined;
  TargetList: undefined;
  TargetPick: undefined;
  TargetEdit: { name?: string; provider?: string };
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
  screen: "TrashAll" | "TargetList" | "Anomalies" | "SettingsHome";
  label: TranslationKey;
  glyph: string;
}

/**
 * The phone's navigation in one table: four places on the bar and the rest in
 * the More sheet, so the bar and the sheet cannot disagree about either.
 */
export const BAR: BarPlace[] = [
  { tab: "OverviewTab", label: "nav.overview", glyph: "IconDashboard" },
  { tab: "JobsTab", label: "nav.jobs", glyph: "IconSync" },
  { tab: "ConflictsTab", label: "nav.conflicts", glyph: "IconConflict" },
  { tab: "HistoryTab", label: "nav.history", glyph: "IconHistory" },
];

/**
 * In the web rail's order, Settings last as the rail has it; Anomalies goes
 * while its notes are switched off.
 */
export const MORE: MorePlace[] = [
  { screen: "Anomalies", label: "nav.anomalies", glyph: "IconAnomalies" },
  { screen: "TrashAll", label: "nav.trash", glyph: "IconTabRecovery" },
  { screen: "TargetList", label: "nav.targets", glyph: "IconTabStorage" },
  { screen: "SettingsHome", label: "nav.settings", glyph: "IconGear" },
];
