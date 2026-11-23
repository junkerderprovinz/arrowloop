import assert from "node:assert/strict";
import { test } from "node:test";
import { saveTarget, type TargetCalls } from "./targetSave.ts";

function engine(taken: string[] = []) {
  const made: string[] = [];
  const edited: { id: string; label: string }[] = [];
  const calls: TargetCalls = {
    addRemote: async ({ label }) => {
      if (taken.includes(label)) throw Object.assign(new Error("taken"), { code: "target-name-taken" });
      made.push(label);
      return { saved: label.replaceAll(" ", "-") };
    },
    saveRemote: async (id, { label }) => {
      if (taken.includes(label)) throw Object.assign(new Error("taken"), { code: "target-name-taken" });
      edited.push({ id, label });
      return { saved: id };
    },
  };
  return { calls, made, edited };
}

const form = { type: "sftp", settings: { host: "lab.example" } };

test("a new target saves under a name with spaces and a dash", async () => {
  const { calls, made, edited } = engine();
  assert.deepEqual(await saveTarget(calls, undefined, " SFTP Home - Lab ", form), { saved: "SFTP-Home---Lab" });
  assert.deepEqual(made, ["SFTP Home - Lab"]);
  assert.deepEqual(edited, []);
});

test("a rename saves the same target under its id and adds none", async () => {
  const { calls, made, edited } = engine();
  assert.deepEqual(await saveTarget(calls, "SFTP-1", "OneDrive - Business", form), { saved: "SFTP-1" });
  assert.deepEqual(edited, [{ id: "SFTP-1", label: "OneDrive - Business" }]);
  assert.deepEqual(made, []);
});

test("an empty name is refused with a sentence and sends nothing", async () => {
  const { calls, made, edited } = engine();
  assert.deepEqual(await saveTarget(calls, undefined, "   ", form), { refused: { key: "targets.nameNeeded" } });
  assert.equal(made.length + edited.length, 0);
});

test("a name another target has is refused with a sentence that names it", async () => {
  const { calls } = engine(["Backup"]);
  assert.deepEqual(await saveTarget(calls, undefined, "Backup", form), {
    refused: { key: "targets.nameTaken", vars: { name: "Backup" } },
  });
  assert.deepEqual(await saveTarget(calls, "Archive", "Backup", form), {
    refused: { key: "targets.nameTaken", vars: { name: "Backup" } },
  });
});

test("any other failure reaches the form as it came", async () => {
  const calls: TargetCalls = {
    addRemote: () => Promise.reject(new Error("no such backend")),
    saveRemote: () => Promise.reject(new Error("unused")),
  };
  await assert.rejects(saveTarget(calls, undefined, "Lab", form), /no such backend/);
});
