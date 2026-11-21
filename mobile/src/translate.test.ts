import assert from "node:assert/strict";
import { test } from "node:test";
import { entryNote } from "../../web/src/lib/entryLabel.ts";
import { failureLine } from "../../web/src/lib/failure.ts";
import { de } from "../../web/src/lib/i18n.data.ts";
import { translator } from "./translate.ts";

const t = translator(de);
const spell = { lang: "de", moment: (iso: string) => iso };

test("a skip that carries its reason's code reads in the app's language", () => {
  const line = {
    Kind: "skip",
    Side: "",
    Note: "Another program holds the file open on the left. It waits until the file is closed.",
    Code: "heldOpen",
    Vars: { side: "left" },
  };
  assert.equal(entryNote(t, line, spell), "Ein anderes Programm hält die Datei links offen. ArrowLoop wartet, bis sie geschlossen wird.");
});

test("a file written to while it was copied says how it grew, in the app's language", () => {
  const line = {
    Kind: "skip",
    Side: "",
    Note: "The file was being written on the left while it was copied, in 4 runs in a row. It waits for the next run. While it was read its size changed from 2048 to 4096 bytes.",
    Code: "inFlux",
    Vars: { side: "left", runs: "4", details: "While it was read its size changed from 2048 to 4096 bytes.", sizeFrom: "2048", sizeTo: "4096" },
  };
  assert.equal(
    entryNote(t, line, spell),
    "Die Datei wurde links während des Kopierens beschrieben, schon 4 Läufe hintereinander. Sie bleibt für den nächsten Lauf liegen. Beim Lesen änderte sich die Größe von 2.048 auf 4.096 Byte.",
  );
});

test("a skip from an older engine shows the note it was recorded with", () => {
  const line = { Kind: "skip", Side: "", Note: "copy failed, leaving it for the next run: permission denied" };
  assert.equal(entryNote(t, line, spell), "copy failed, leaving it for the next run: permission denied");
});

test("a reason this build has no sentence for shows the engine's own", () => {
  const line = { Kind: "skip", Side: "", Note: "a reason from a newer engine", Code: "somethingNewer", Vars: { side: "left" } };
  assert.equal(entryNote(t, line, spell), "a reason from a newer engine");
});

test("files left for later twice read in the app's language on the failure line", () => {
  const failure = {
    code: "leftTwice",
    twice: {
      files: [
        {
          path: "status.fifo",
          code: "unsupported",
          vars: { kind: "named pipe", side: "left" },
          text: "The named pipe on the left is something this engine does not carry.",
        },
      ],
    },
  };
  assert.equal(
    failureLine("left for later in two runs in a row: status.fifo", failure, t, "de", spell),
    `${de["failure.leftTwice"]} status.fifo: Links liegt eine benannte Pipe. So etwas nimmt dieser Dienst nicht mit.`,
  );
});

test("a file left twice whose reason has no code keeps the engine's English", () => {
  const failure = { code: "leftTwice", twice: { files: [{ path: "odd.bin", code: "", text: "A reason from an older engine." }] } };
  assert.equal(
    failureLine("left for later in two runs in a row: odd.bin", failure, t, "de", spell),
    `${de["failure.leftTwice"]} odd.bin: A reason from an older engine.`,
  );
});

test("a sentence missing from a table falls back to English", () => {
  assert.equal(translator({})("side.left"), "left");
});
