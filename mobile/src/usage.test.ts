import assert from "node:assert/strict";
import { test } from "node:test";
import { usageShown } from "./usage.ts";

const lines: Record<string, string> = {
  "targets.spaceFree": "{free} of {total} free",
  "targets.spaceUsed": "{used} in use",
  "targets.spaceTotal": "{total} in total",
};
const t = (key: string, vars?: Record<string, string | number>) =>
  (lines[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ""));

test("a target that cannot say how full it is shows nothing", () => {
  assert.equal(usageShown({ supported: false }, t), null);
});

test("a target that answered without a figure shows nothing", () => {
  assert.equal(usageShown({ supported: true }, t), null);
});

test("an account without a quota shows what it holds", () => {
  assert.deepEqual(usageShown({ supported: true, used: 3 * 1024 ** 3 }, t), { line: "3.0 GB in use" });
});

test("a disk shows its bar and what is free", () => {
  assert.deepEqual(usageShown({ supported: true, total: 1000, free: 400 }, t), {
    line: "400 B of 1000 B free",
    meter: { done: 600, total: 1000 },
  });
});
