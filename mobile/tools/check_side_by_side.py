#!/usr/bin/env python3
"""Resolves the Expo config with and without ARROWLOOP_SIDE_BY_SIDE.

The released build must keep its package, name, link scheme and engine port,
and the test build must differ in each, or the two cannot be installed on one
phone together.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

MOBILE = Path(__file__).resolve().parent.parent

EXPECTED = {
    "": {
        "name": "ArrowLoop",
        "scheme": "arrowloop",
        "package": "arrowloop.halleluja.design",
        "sideBySide": False,
        "enginePort": 8422,
    },
    "1": {
        "name": "ArrowLoop Test",
        "scheme": "arrowloop-test",
        # withEngine.js adds the .test suffix in Gradle, so the Kotlin
        # namespace and R stay where the native sources expect them.
        "package": "arrowloop.halleluja.design",
        "sideBySide": True,
        "enginePort": 8423,
    },
}


def resolve(switch: str) -> dict:
    env = {k: v for k, v in os.environ.items() if k != "ARROWLOOP_SIDE_BY_SIDE"}
    if switch:
        env["ARROWLOOP_SIDE_BY_SIDE"] = switch
    # npx is npx.cmd on Windows, which subprocess only finds by its full path.
    npx = shutil.which("npx")
    if npx is None:
        sys.exit("check_side_by_side: npx is not on PATH")
    out = subprocess.run(
        [npx, "expo", "config", "--json"],
        cwd=MOBILE,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    config = json.loads(out)
    extra = config.get("extra", {})
    return {
        "name": config.get("name"),
        "scheme": config.get("scheme"),
        "package": config.get("android", {}).get("package"),
        "sideBySide": extra.get("sideBySide"),
        "enginePort": extra.get("enginePort"),
    }


def main() -> int:
    problems = []
    for switch, want in EXPECTED.items():
        got = resolve(switch)
        label = f"ARROWLOOP_SIDE_BY_SIDE={switch or '(unset)'}"
        for key, value in want.items():
            if got[key] != value:
                problems.append(f"{label}: {key} is {got[key]!r}, expected {value!r}")
        print(f"{label}: {got}")

    for problem in problems:
        print(problem)
    print(f"check_side_by_side: {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
