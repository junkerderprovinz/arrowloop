import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

// One stack per tab, so back from a detail returns to that tab's list and not
// to whatever was open in another tab.

/** A stack of one, so the overview tab is built like the others and has a header. */
export type OverviewStack = {
  OverviewHome: undefined;
};

export type JobsStack = {
  JobList: undefined;
  JobDetail: { name: string };
  /** No name means a new job. */
  JobEdit: { name?: string };
  Plan: { name: string };
  Trash: { name: string; side: "left" | "right" };
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
