import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

/**
 * Where each tab can go.
 *
 * A stack per tab rather than one across the app, which is what makes the back
 * gesture do the obvious thing: leaving a job's detail returns to the job list
 * and not to whatever was open in another tab. Android's back button is a
 * promise about where you came from, and a single stack breaks it the first
 * time somebody switches tabs mid-task.
 */
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
  /**
   * Everything a job starts from, on a page of its own.
   *
   * It used to be five separate cards on the settings page - what a job does,
   * how hard it pushes, what travels, the brakes, and when the phone lets a due
   * job go ahead - which made a page of fifteen cards where five of them
   * answered one question. Autosync puts the same group behind one entry called
   * "Synchronisation", and the reason holds: these are settings somebody visits
   * when setting the app UP, not settings they pass on the way to the accent
   * colour.
   */
  Sync: undefined;
};

export type Nav<T extends Record<string, object | undefined>> = NativeStackNavigationProp<T>;
