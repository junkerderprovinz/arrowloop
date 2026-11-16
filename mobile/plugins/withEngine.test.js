const assert = require("node:assert/strict");
const { test } = require("node:test");
const app = require("../app.json");
const { addRotation } = require("./withEngine.js");

// The part of Expo's MainActivity template the plugin edits.
const TEMPLATE = `package arrowloop.halleluja.design

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"
}
`;

test("the manifest leaves the orientation to the activity", () => {
  assert.equal(app.expo.orientation, "default");
});

test("the activity decides the orientation before its first frame", () => {
  const out = addRotation(TEMPLATE);
  const decided = out.indexOf("followRotationOnTablets(resources.configuration)");
  assert.ok(decided > 0);
  assert.ok(decided < out.indexOf("super.onCreate(null)"));
});

test("the activity decides again when the screen changes size", () => {
  const out = addRotation(TEMPLATE);
  assert.match(out, /import android\.content\.res\.Configuration/);
  assert.match(
    out,
    /override fun onConfigurationChanged\(newConfig: Configuration\) \{\s*super\.onConfigurationChanged\(newConfig\)\s*followRotationOnTablets\(newConfig\)/,
  );
});

test("a second prebuild over the same file changes nothing", () => {
  const once = addRotation(TEMPLATE);
  assert.equal(addRotation(once), once);
});

test("a template of another shape fails the build", () => {
  assert.throws(() => addRotation("class MainActivity : ReactActivity() {}"), /MainActivity/);
});
