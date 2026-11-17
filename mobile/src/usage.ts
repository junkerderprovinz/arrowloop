import type { Usage } from "./api";
import type { T } from "./i18n";

export function bytes(n: number | undefined): string {
  if (n === undefined) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Returns the line and bar a target's answer allows, or null when it gave no
 * figure: a bucket has none, a disk has all three.
 */
export function usageShown(usage: Usage, t: T): { line: string; meter?: { done: number; total: number } } | null {
  if (!usage.supported) return null;
  const total = usage.total ?? 0;
  const free = usage.free;
  // Zero used is a real answer, hence `??`.
  const used = usage.used ?? (total > 0 && free !== undefined ? total - free : undefined);
  if (total <= 0 && used === undefined) return null;

  const line =
    total > 0 && free !== undefined
      ? t("targets.spaceFree", { free: bytes(free), total: bytes(total) })
      : used !== undefined
        ? t("targets.spaceUsed", { used: bytes(used) })
        : t("targets.spaceTotal", { total: bytes(total) });
  return total > 0 ? { line, meter: { done: used ?? 0, total } } : { line };
}
