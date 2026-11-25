import assert from "node:assert/strict";
import { test } from "node:test";
import type { Remote } from "./api.ts";
import { ROOT_MARKER, rootWritten } from "./rootTarget.ts";

const root: Remote = {
  name: "Root",
  type: "sftp",
  settings: [
    { key: "host", value: "127.0.0.1", secret: false },
    { key: "description", value: ROOT_MARKER, secret: false },
  ],
};
const phone = "/storage/emulated/0/Backup";

test("a job that would write to the Root target names that side", () => {
  assert.equal(rootWritten({ left: "Root:/data", right: phone }, [root]), "left");
  assert.equal(rootWritten({ left: phone, right: "Root:/data", direction: "leftToRight" }, [root]), "right");
  assert.equal(rootWritten({ left: "Root:/data", right: phone, direction: "leftToRight", mode: "move" }, [root]), "left");
  assert.equal(rootWritten({ left: "Root:/data", right: phone, direction: "rightToLeft", mode: "mirror" }, [root]), "left");
});

test("a one-way job that only reads from the Root target passes", () => {
  assert.equal(rootWritten({ left: "Root:/data", right: phone, direction: "leftToRight" }, [root]), null);
  assert.equal(rootWritten({ left: "Root:/data", right: phone, direction: "leftToRight", mode: "mirror" }, [root]), null);
  assert.equal(rootWritten({ left: phone, right: "Root:/data", direction: "rightToLeft" }, [root]), null);
});

test("a target someone named Root takes writes", () => {
  const own: Remote = { name: "Root", type: "local", settings: [] };
  assert.equal(rootWritten({ left: "Root:/data", right: phone }, [own]), null);
});
