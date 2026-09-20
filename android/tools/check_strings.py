# -*- coding: utf-8 -*-
"""Checks that every translation carries the same placeholders as the original.

`getString(id, a, b)` fills by position, so a translation with one placeholder
fewer silently drops the remaining arguments. Android Lint calls this check
StringFormatMatches; the build does not run Lint.

A translation may not add a key the original lacks, since it would never be
read. Missing keys are fine: Android falls back to values/, and they are only
counted.
"""
import io
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

# The WebView shell's resources; the mobile workflow passes the React Native
# app's mobile/native/res instead.
DEFAULT_RES = Path(__file__).parent.parent / "app" / "src" / "main" / "res"

# `%1$s`, `%2$d`, and the bare `%s` Android also accepts.
PLACEHOLDER = re.compile(r"%(\d+\$)?[a-zA-Z]")


def strings(path):
    """Key to text, from one strings.xml."""
    root = ET.fromstring(io.open(path, encoding="utf-8").read())
    return {el.get("name"): "".join(el.itertext()) for el in root.iter("string")}


def marks(text):
    """The placeholders of a text, as a set, since a translation may move one
    or use it twice."""
    return {m.group(0) for m in PLACEHOLDER.finditer(text)}


def main():
    res = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_RES
    # The shell has values/strings.xml; the config plugin writes
    # values/strings_engine.xml so it cannot collide with the one prebuild
    # generates.
    base = next(iter(sorted(res.glob("values/strings*.xml"))), None)
    if base is None or not base.is_file():
        raise SystemExit("no values/strings*.xml under %s" % res)
    original = strings(base)
    stem = base.name

    problems = []
    checked = 0
    for folder in sorted(res.glob("values-*")):
        path = folder / stem
        if not path.is_file():
            continue
        translated = strings(path)
        missing = sorted(set(original) - set(translated))
        for key, text in sorted(translated.items()):
            if key not in original:
                problems.append(
                    "%s: %s is not in values/, so this line is never read"
                    % (folder.name, key)
                )
                continue
            checked += 1
            want, have = marks(original[key]), marks(text)
            if want != have:
                problems.append(
                    "%s: %s has %s, the original has %s"
                    % (folder.name, key, sorted(have) or "no placeholders", sorted(want) or "none")
                )
        print("%s: %d keys checked, %d missing (those fall back to values/)%s"
              % (folder.name, len(translated), len(missing),
                 ": " + ", ".join(missing) if missing else ""))

    if problems:
        print()
        for line in problems:
            print("  " + line)
        raise SystemExit("\n%d problems in the translations" % len(problems))
    print("%d translated keys, every placeholder matches" % checked)


if __name__ == "__main__":
    main()
