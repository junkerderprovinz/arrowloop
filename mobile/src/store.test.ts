import assert from "node:assert/strict";
import { test } from "node:test";

import { updatesFrom } from "./store.ts";

test("the Version card names the store that installed the app", () => {
  assert.deepEqual(updatesFrom("com.android.vending"), { kind: "store", store: "Google Play" });
  assert.deepEqual(updatesFrom("org.fdroid.fdroid"), { kind: "store", store: "F-Droid" });
  assert.deepEqual(updatesFrom("com.looker.droidify"), { kind: "store", store: "F-Droid" });
});

test("an APK installed by hand finds its next version on the release page", () => {
  assert.deepEqual(updatesFrom(""), { kind: "direct" });
  assert.deepEqual(updatesFrom("com.google.android.packageinstaller"), { kind: "direct" });
});
