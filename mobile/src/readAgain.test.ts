import assert from "node:assert/strict";
import { test } from "node:test";
import { follow, type Cues } from "./readAgain.ts";

/** Cues a test fires by hand, with a clock it moves itself. */
function fake() {
  const fire = { focus: () => {}, front: () => {}, open: () => {}, event: (_phase: string) => {} };
  let off = 0;
  const later: { at: number; run: () => void }[] = [];
  let now = 0;
  const cues: Cues = {
    focus: (read) => ((fire.focus = read), () => off++),
    front: (read) => ((fire.front = read), () => off++),
    stream: (onEvent, onOpen) => ((fire.event = (phase) => onEvent({ phase })), (fire.open = onOpen), () => off++),
    now: () => now,
    after: (ms, run) => {
      later.push({ at: now + ms, run });
      return () => {};
    },
  };
  const tick = (ms: number) => {
    now += ms;
    for (const l of later.splice(0).filter((l) => l.at <= now)) l.run();
  };
  return { cues, fire, tick, off: () => off };
}

test("a screen reads again when it comes into view, so a target made elsewhere is there to choose", () => {
  const { cues, fire } = fake();
  let reads = 0;
  follow({ focus: cues.focus }, () => reads++);
  fire.focus();
  fire.focus();
  assert.equal(reads, 2);
});

test("a screen reads again when the app comes back to the front, since the engine ran on while it was away", () => {
  const { cues, fire } = fake();
  let reads = 0;
  follow(cues, () => reads++);
  fire.front();
  assert.equal(reads, 1);
});

test("a screen reads again when the stream connects again, since nothing reached it while it was down", () => {
  const { cues, fire } = fake();
  let reads = 0;
  follow(cues, () => reads++);
  fire.open();
  assert.equal(reads, 1);
});

test("a run's events read again at most once a second, the last one of a burst included", () => {
  const { cues, fire, tick } = fake();
  let reads = 0;
  follow(cues, () => reads++);
  fire.event("started");
  fire.event("file");
  fire.event("finished");
  assert.equal(reads, 1);
  tick(1000);
  assert.equal(reads, 2);
});

test("progress frames read nothing again", () => {
  const { cues, fire, tick } = fake();
  let reads = 0;
  follow(cues, () => reads++);
  fire.event("moving");
  tick(2000);
  assert.equal(reads, 0);
});

test("a screen that goes stops listening to every cue", () => {
  const { cues, off } = fake();
  follow(cues, () => {})();
  assert.equal(off(), 3);
});
