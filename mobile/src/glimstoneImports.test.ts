import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The index of @glimstone/core loads every module it has, and some create Intl
// objects as they load (avatar.ts a Segmenter) that Hermes does not have, so
// the app dies at its start. The phone takes what it needs from subpaths.

const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATEMENT = /^\s*(import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']/gm;

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every source file the app loads at run time, from its entry points on. */
function loaded(): Map<string, string> {
  const files = new Map<string, string>();
  const queue = [join(MOBILE, "index.ts"), join(MOBILE, "App.tsx")];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    const text = readFileSync(file, "utf8");
    files.set(file, text);
    for (const [, , what, spec] of text.matchAll(STATEMENT)) {
      if (!spec.startsWith(".") || what.startsWith("type ")) continue;
      const next = resolveLocal(file, spec);
      if (next) queue.push(next);
    }
  }
  return files;
}

test("nothing the phone loads imports the index of @glimstone/core", () => {
  const files = loaded();
  assert.ok(files.size > 50, `walked only ${files.size} files`);
  const offenders = [...files].flatMap(([file, text]) =>
    [...text.matchAll(STATEMENT)]
      .filter(([, , what, spec]) => spec === "@glimstone/core" && !what.startsWith("type "))
      .map(([statement]) => `${file}: ${statement.trim()}`),
  );
  assert.deepEqual(offenders, []);
});
