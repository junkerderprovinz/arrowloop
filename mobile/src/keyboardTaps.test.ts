import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// A scroll view's default dismisses the keyboard with the first tap and drops
// the tap, so a button under an open keyboard has to be pressed twice. A
// nested one does it even inside a page that keeps its taps.

const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCROLLER = /^\s*<(ScrollView|FlatList)\b/gm;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "glimstone" ? [] : sources(path);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path] : [];
  });
}

/** The tag that starts at `from`, up to the bracket that closes it outside any braces. */
function tagAt(text: string, from: number): string {
  let depth = 0;
  for (let i = from + 1; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
    else if (text[i] === ">" && depth === 0) return text.slice(from, i);
  }
  return text.slice(from);
}

test("every scroll view lets a tap through while the keyboard is open", () => {
  const missing: string[] = [];
  for (const file of [join(MOBILE, "App.tsx"), ...sources(join(MOBILE, "src"))]) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(SCROLLER)) {
      const tag = tagAt(text, match.index + match[0].indexOf("<"));
      if (!tag.includes('keyboardShouldPersistTaps="handled"')) missing.push(`${file.slice(MOBILE.length + 1)}: ${match[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});
