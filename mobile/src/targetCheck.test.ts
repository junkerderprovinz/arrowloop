import assert from "node:assert/strict";
import { test } from "node:test";
import { checkWord } from "../../web/src/lib/targetCheck.ts";

test("a target behind a VPN that is off reads as going through it, not as unreachable", () => {
  assert.equal(checkWord({ ok: false, unchecked: true }), "targets.throughVpn");
});

test("a check that answered says connected or not connected", () => {
  assert.equal(checkWord({ ok: true }), "targets.checkOk");
  assert.equal(checkWord({ ok: false }), "targets.checkFailed");
});
