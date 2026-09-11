#!/usr/bin/env python3
"""The app's idea of the engine's answers, checked against a real engine.

`src/api.ts` declares what comes back from every endpoint, and TypeScript
believes every word of it: a declaration is a promise, not a measurement, so a
field the engine calls `reason` and the app calls `error` compiles perfectly and
renders an empty string. Four of those shipped at once - a red badge with no
sentence under it, an edit form whose fields were all empty, a bin where every
row said "age unknown", and a restore that posted a list to an endpoint that
takes one file.

None of them is visible to the compiler, to the language tests, or to a screen
that renders an empty string where a sentence should be. This is the only check
that can see them, because it is the only one that asks the engine.

Run it against a live engine:

    python mobile/tools/check_shapes.py http://127.0.0.1:8422

It reports a field the app declares and the engine never sends, which is the
direction that matters. The other direction - the engine sending more than the
app reads - is normal and says nothing.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = Path(__file__).resolve().parent.parent / "src" / "api.ts"

# Which interface describes which endpoint, and how to reach the object. A
# `[]` means the answer is a list and the shape describes one element; a
# name after it means the objects are under that key.
CHECKS = [
    ("Job", "/api/jobs", ["[]"]),
    ("Run", "/api/history?limit=1", ["[]"]),
    ("Entry", "/api/history/1/entries", ["[]"]),
    ("Plan", "/api/jobs/{job}/plan", []),
    ("Action", "/api/jobs/{job}/plan", ["actions", "[]"]),
    ("Reason", "/api/jobs/{job}/plan", ["actions", "[]", "reason"]),
    ("Storage", "/api/remotes", []),
    ("Remote", "/api/remotes", ["remotes", "[]"]),
    ("Provider", "/api/remotes", ["providers", "[]"]),
    ("Backend", "/api/remotes", ["backends", "[]"]),
    ("Bin", "/api/jobs/{job}/trash/left", []),
    ("TrashItem", "/api/jobs/{job}/trash/left", ["entries", "[]"]),
    # Only when the service actually answers the question: a target that says
    # `supported: false` sends none of the three numbers, and that is the
    # correct answer rather than a missing field.
    ("Usage", "/api/remotes/{remote}/about", [], ("supported", True)),
]

# The shapes whose absence is a FAILED check rather than a quiet skip.
#
# A checker that reports nothing because it could reach nothing is the same
# blind pass as a test that cannot fail. These three need real divergence to
# exist at all - an empty plan carries no actions and therefore no reason - so
# a run against an engine whose sides already agree has not checked them, and
# has to say so with its exit code rather than a line nobody reads.
REQUIRED = {"Action", "Reason", "TrashItem"}

# Every entry is (interface, path, into) with an optional fourth element: a
# (key, value) the answer must carry for the check to mean anything.
CHECKS = [check if len(check) == 4 else (*check, None) for check in CHECKS]


def declared(source: str, name: str) -> tuple[set[str], set[str]] | None:
    """What one interface declares, split into required and optional.

    Both halves are checked, and differently. A REQUIRED field has to be in
    every object. An OPTIONAL one only has to turn up in at least one of them -
    `Action.right` is genuinely absent when only the left has the file, while
    `TrashItem.deleted` was absent from every entry ever sent, because the
    engine calls it `filed`. Sampling one object cannot tell those apart;
    sampling all of them can.
    """
    match = re.search(
        rf"^export interface {re.escape(name)} \{{(.*?)^\}}", source, re.M | re.S
    )
    if not match:
        return None
    body = match.group(1)
    # An index signature means the shape is deliberately open; nothing to check.
    if re.search(r"^\s*\[key: string\]", body, re.M):
        return set(), set()
    need, maybe = set(), set()
    for field in re.finditer(r"^\s{2}(\w+)(\??):", body, re.M):
        (maybe if field.group(2) else need).add(field.group(1))
    return need, maybe


def dig(value, path: list[str]) -> list[dict]:
    """Every object the path reaches, which is more than one wherever it
    crosses a list. Empty when the path runs out of data."""
    here = [value]
    for step in path:
        out = []
        for item in here:
            if step == "[]":
                if isinstance(item, list):
                    out.extend(item)
            elif isinstance(item, dict) and step in item:
                out.append(item[step])
        here = out
        if not here:
            return []
    return [item for item in here if isinstance(item, dict)]


def get(origin: str, path: str):
    with urllib.request.urlopen(origin + path, timeout=10) as answer:
        return json.loads(answer.read() or "null")


def main() -> int:
    origin = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8422").rstrip("/")
    source = API.read_text(encoding="utf-8")

    try:
        jobs = get(origin, "/api/jobs")
        storage = get(origin, "/api/remotes")
    except (urllib.error.URLError, OSError) as trouble:
        print(f"check_shapes: no engine at {origin}: {trouble}")
        return 2
    if not jobs:
        print("check_shapes: the engine has no job configured, so most shapes")
        print("cannot be asked for. Point it at a config with one.")
        return 2

    job = jobs[0]["name"]
    remotes = storage.get("remotes") or []
    remote = remotes[0]["name"] if remotes else None

    problems: list[str] = []
    unchecked: list[str] = []
    for name, path, into, only in CHECKS:
        if "{remote}" in path and remote is None:
            unchecked.append(f"{name}: no target configured")
            continue
        shape = declared(source, name)
        if shape is None:
            problems.append(f"{name}: no such interface in api.ts")
            continue
        need, maybe = shape
        if not need and not maybe:
            continue
        try:
            answer = get(origin, path.format(job=job, remote=remote))
        except urllib.error.HTTPError as trouble:
            unchecked.append(f"{name}: {path} answered {trouble.code}")
            continue
        found = dig(answer, into)
        if not found:
            unchecked.append(f"{name}: nothing at {path} to look at")
            continue
        if only is not None and found[0].get(only[0]) != only[1]:
            unchecked.append(f"{name}: {only[0]} is not {only[1]} here")
            continue

        # Required: absent from the first object is absent. Optional: absent
        # from EVERY object is a name nobody sends.
        ever = set().union(*(set(item) for item in found))
        missing = sorted(
            [field for field in need if field not in found[0]]
            + [field for field in maybe if field not in ever]
        )
        if missing:
            problems.append(
                f"{name}: declares {missing} and the engine sent {sorted(ever)}"
            )

    for line in unchecked:
        print(f"not checked - {line}")
    for line in problems:
        print(line)

    blind = sorted(name for name in REQUIRED if any(line.startswith(name + ":") for line in unchecked))
    if blind:
        print(f"check_shapes: {blind} could not be checked at all")
        print("Give the engine two sides that disagree and a bin with something in it.")
    print(f"check_shapes: {len(problems)} problem(s), {len(unchecked)} not checked")
    return 1 if problems or blind else 0


if __name__ == "__main__":
    sys.exit(main())
