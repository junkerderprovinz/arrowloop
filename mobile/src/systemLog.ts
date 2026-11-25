import type { SystemLine } from "./api";
import type { T } from "./i18n";

const SOURCE = {
  rclone: "systemLog.rclone",
  connection: "systemLog.connection",
  integration: "systemLog.integration",
} as const;

export interface LogRow {
  id: number;
  source: string;
  /** The last time the line came. */
  at: string;
  /** How often it came in a row, or null for once. */
  repeat: string | null;
  text: string;
}

/** The system log's lines as the card shows them, newest first as the engine sends them. */
export function logRows(lines: SystemLine[], t: T): LogRow[] {
  return lines.map((line) => ({
    id: line.ID,
    source: t(SOURCE[line.Source]),
    at: line.At,
    repeat: line.Count > 1 ? `${line.Count}×` : null,
    text: line.Text,
  }));
}
