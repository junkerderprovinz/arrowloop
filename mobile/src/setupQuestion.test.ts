import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "../../web/src/lib/i18n.data.ts";
import { oneTimeCode, questionHint, questionLabel, typedAnswer } from "../../web/src/lib/setupQuestion.ts";

test("the phone asks for a two-factor code on its number pad and says where to find it", () => {
  const code = { name: "config_2fa", choices: [] };
  assert.equal(typedAnswer(code), true);
  assert.equal(oneTimeCode(code), true);
  assert.equal(en[questionLabel(code)], "Two-factor code");
  assert.match(en[questionHint(code)], /authenticator app/);
});

test("the phone still lists the drives a sign-in opens", () => {
  const drives = { name: "config_driveid", choices: [{ value: "me", help: "Personal" }] };
  assert.equal(typedAnswer(drives), false);
  assert.equal(en[questionLabel(drives)], "Drive");
});
