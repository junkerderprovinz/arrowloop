import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

// One stack per tab, so back from a detail returns to that tab's list and not
// to whatever was open in another tab.

/**
 * The overview, and the two lists it opens that wait on somebody. The bar has
 * no room for a sixth and seventh tab, so they open from here.
 */
export type OverviewStack = {
  OverviewHome: undefined;
  Conflicts: undefined;
  TrashAll: undefined;
};

export type JobsStack = {
  JobList: undefined;
  JobDetail: { name: string };
  /** No name means a new job. */
  JobEdit: { name?: string };
  Plan: { name: string };
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
