import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

// One stack per tab, so back from a detail returns to that tab's list and not
// to whatever was open in another tab.

/**
 * The overview, and the three lists it opens that wait on somebody. The bar
 * has no room for more tabs, so they open from here.
 */
export type OverviewStack = {
  OverviewHome: undefined;
  /** `job` opens that job's findings. */
  Anomalies: { job?: string } | undefined;
  Conflicts: undefined;
  TrashAll: undefined;
};

export type JobsStack = {
  JobList: undefined;
  JobDetail: { name: string };
  /** No name means a new job. */
  JobEdit: { name?: string };
  Plan: { name: string };
  /** The same screen the overview opens, reached from a job's own card. */
  Anomalies: { job?: string } | undefined;
  /** `place` is the side's name, for the title. */
  Trash: { name: string; side: "left" | "right"; place: string };
};

export type HistoryStack = {
  RunList: undefined;
  RunDetail: { id: number; job: string };
};

export type TargetsStack = {
  TargetList: undefined;
  TargetPick: undefined;
  TargetEdit: { name?: string; provider?: string };
};

export type SettingsStack = {
  SettingsHome: undefined;
  Language: undefined;
  /** The defaults every job starts from, visited while setting the app up. */
  Sync: undefined;
};

export type Nav<T extends Record<string, object | undefined>> = NativeStackNavigationProp<T>;
