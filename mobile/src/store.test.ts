import assert from "node:assert/strict";
import { test } from "node:test";

import { storeOf } from "./store.ts";

test("the Version card names the store that installed the app", () => {
  assert.equal(storeOf("com.android.vending"), "Google Play");
  assert.equal(storeOf("org.fdroid.fdroid"), "F-Droid");
  assert.equal(storeOf("com.looker.droidify"), "F-Droid");
});

test("an APK installed by hand points to the releases on GitHub", () => {
  assert.equal(storeOf(""), "GitHub Releases");
  assert.equal(storeOf("com.google.android.packageinstaller"), "GitHub Releases");
});
