import assert from "node:assert/strict";
import { test } from "node:test";
import { pluginLook } from "./pluginLook.ts";

const base = { theme: "system", oled: false, accent: "#1D99F3", lock: false, shape: "soft" } as const;

test("the picker gets the accent the screens show, with its ink, for either look", () => {
  const look = pluginLook(base, undefined, 8);
  assert.deepEqual(look.light, { accent: "#1D99F3", ink: "#161616" });
  assert.deepEqual(look.dark, { accent: "#1D99F3", ink: "#161616" });
});

test("the system's colour differs between the two looks", () => {
  const look = pluginLook({ ...base, accent: "system" }, { light: "#3a5ba9", dark: "#b0c6ff" }, 8);
  assert.equal(look.light.accent, "#3a5ba9");
  assert.equal(look.light.ink, "#FFFFFF");
  assert.equal(look.dark.accent, "#b0c6ff");
});

test("the system's colour on a phone without one falls back to the default", () => {
  const look = pluginLook({ ...base, accent: "system" }, undefined, 8);
  assert.equal(look.light.accent, "#FCC419");
});

test("the theme, OLED, the lock and the shape come along", () => {
  const look = pluginLook({ ...base, theme: "dark", oled: true, lock: true, shape: "leaf" }, undefined, 20);
  assert.equal(look.theme, "dark");
  assert.equal(look.oled, true);
  assert.equal(look.lock, true);
  assert.equal(look.leaf, true);
  assert.equal(look.radius, 20);
});
