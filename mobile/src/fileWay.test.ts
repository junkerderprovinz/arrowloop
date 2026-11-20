import assert from "node:assert/strict";
import { test } from "node:test";
import { fileWay } from "./fileWay.ts";

const lines: Record<string, string> = {
  "side.onDevice": "Device folder",
  "side.target": "Target folder",
};
const t = (key: string) => lines[key] ?? key;

const jobs = [{ id: "j1", name: "Backups", left: "/storage/emulated/0/ArrowLoop", right: "nextcloud:Backups" }];

test("a copied file goes from one side's name to the other's", () => {
  const line = { Job: "Backups", Kind: "copy", Side: "right", Note: "" };
  assert.deepEqual(fileWay(line, jobs, t), { from: "Device folder", to: "nextcloud" });
});

test("a file copied the other way points back", () => {
  const line = { Job: "Backups", Kind: "copy", Side: "left", Note: "replaced" };
  assert.deepEqual(fileWay(line, jobs, t), { from: "nextcloud", to: "Device folder" });
});

test("a trashed file names the side it went to the trash on", () => {
  const line = { Job: "Backups", Kind: "trash", Side: "right", Note: "bin" };
  assert.deepEqual(fileWay(line, jobs, t), { on: "nextcloud" });
});

test("a job renamed since is still found by its id", () => {
  const line = { Job: "Old name", JobID: "j1", Kind: "copy", Side: "right" };
  assert.deepEqual(fileWay(line, jobs, t), { from: "Device folder", to: "nextcloud" });
});

test("a job that is gone gives no way", () => {
  const line = { Job: "Deleted", Kind: "copy", Side: "right" };
  assert.equal(fileWay(line, jobs, t), null);
});

test("a skip keeps to its own label", () => {
  const line = { Job: "Backups", Kind: "skip", Side: "right", Note: "uploadFailed" };
  assert.equal(fileWay(line, jobs, t), null);
});
