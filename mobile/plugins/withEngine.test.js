const assert = require("node:assert/strict");
const { test } = require("node:test");
const app = require("../app.json");
const { addRotation, addStartJob } = require("./withEngine.js");

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

test("the manifest lets the app read the wifi's name", () => {
  // WifiManager refuses getConnectionInfo without ACCESS_WIFI_STATE, location or not.
  for (const permission of ["ACCESS_WIFI_STATE", "ACCESS_FINE_LOCATION"]) {
    assert.ok(app.expo.android.permissions.includes(`android.permission.${permission}`), permission);
  }
});

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

const EDIT = "com.twofortyfouram.locale.intent.action.EDIT_SETTING";
const FIRE = "com.twofortyfouram.locale.intent.action.FIRE_SETTING";

function actionsOf(entry) {
  return entry["intent-filter"].flatMap((f) => f.action.map((a) => a.$["android:name"]));
}

test("automation apps find the picker and the receiver", () => {
  const app = {};
  addStartJob(app);
  const picker = app.activity.find((a) => a.$["android:name"] === ".StartJobActivity");
  const receiver = app.receiver.find((r) => r.$["android:name"] === ".StartJobReceiver");
  // The plug-in API ignores a plug-in whose two parts are not both exported.
  assert.equal(picker.$["android:exported"], "true");
  assert.equal(receiver.$["android:exported"], "true");
  assert.deepEqual(actionsOf(picker), [EDIT]);
  assert.deepEqual(actionsOf(receiver), [FIRE]);
  assert.ok(picker.$["android:label"]);
  assert.ok(picker.$["android:icon"]);
});

test("the receiver asks for no permission the automation apps would lack", () => {
  const app = {};
  addStartJob(app);
  const receiver = app.receiver.find((r) => r.$["android:name"] === ".StartJobReceiver");
  assert.equal(receiver.$["android:permission"], undefined);
});

test("a second prebuild adds the plug-in once", () => {
  const app = { activity: [{ $: { "android:name": ".MainActivity" } }] };
  addStartJob(app);
  addStartJob(app);
  assert.equal(app.activity.length, 2);
  assert.equal(app.receiver.length, 1);
});
