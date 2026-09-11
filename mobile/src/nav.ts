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
};

export type Nav<T extends Record<string, object | undefined>> = NativeStackNavigationProp<T>;
