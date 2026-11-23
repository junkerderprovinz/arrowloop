import assert from "node:assert/strict";
import { test } from "node:test";
import type { Remote } from "./api";
import { targetRows } from "./targetList.ts";

const target = (name: string, type: string, remote?: string): Remote =>
  ({ name, label: name, type, settings: remote ? [{ key: "remote", value: remote, secret: false }] : [] }) as unknown as Remote;

test("a target that is a folder on the phone stays on the Targets screen after it is saved", () => {
  const rows = targetRows([target("Phone-Store-Lab", "alias", "/storage/emulated/0/ALTest"), target("SFTP-Home-Lab", "sftp")]);
  assert.deepEqual(
    rows.map((r) => r.remote.name),
    ["Phone-Store-Lab", "SFTP-Home-Lab"],
  );
});

test("only storage elsewhere is asked whether it answers and how full it is", () => {
  const rows = targetRows([target("Phone-Store-Lab", "alias", "/storage/emulated/0/ALTest"), target("SFTP-Home-Lab", "sftp")]);
  assert.deepEqual(
    rows.map((r) => r.elsewhere),
    [false, true],
  );
});
