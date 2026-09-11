#!/usr/bin/env python3
"""Every translation key the app asks for, checked against the English table.

Three failures, and the compiler catches none of them:

  * a key that does not exist - `t()` is typed, but a key assembled at runtime
    or a table entry renamed on the web side slips straight through;
  * a sentence with a placeholder asked for WITHOUT one, which renders a
    literal `{count}` on screen, in every language at once;
  * a placeholder passed that the sentence does not carry, which is silently
    dropped and usually means the wrong key was picked.

The third is the one that found the real bug: the phone screens were built by
reaching for whatever key said something roughly similar, and roughly similar
reads, in German, as a sentence about something else entirely.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MOBILE = HERE.parent
TABLE = MOBILE.parent / "web" / "src" / "lib" / "i18n.data.ts"

# `t("key")` or `t("key", { a: 1 })`, plus the `t(cond ? "a" : "b")` shape the
# screens use for a side. The trailing group tells the two apart.
CALL = re.compile(r"""\bt\(\s*(?P<args>(?:[^()]|\([^()]*\))*)\)""")
KEY = re.compile(r"""["']([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)["']""")
PLACEHOLDER = re.compile(r"\{([a-zA-Z0-9_]+)\}")


def english() -> dict[str, str]:
    """The English table, values joined even where they wrap over lines."""
    text = TABLE.read_text(encoding="utf-8")
    start = text.index("export const en = {")
    # The table ends at the first line that is a closing brace on its own.
    end = text.index("\n}", start)
    # The trailing newline is not cosmetic: without it the LAST key in the
    # table has nothing after it for the lookahead to find, and the parser
    # silently drops one key - which reads, from the outside, exactly like a
    # screen asking for a key that does not exist.
    body = text[start:end] + "\n"
    out: dict[str, str] = {}
    # A value may run over several lines; the key always starts one.
    for chunk in re.finditer(
        r"^  '(?P<key>[^']+)':\s*(?P<value>.*?),?\n(?=  '|\s*//|\Z)",
        body,
        re.M | re.S,
    ):
        out[chunk.group("key")] = chunk.group("value")
    return out


def main() -> int:
    table = english()
    if len(table) < 100:
        print(f"check_keys: read only {len(table)} keys from {TABLE} - parser is wrong")
        return 2

    problems: list[str] = []
    for path in sorted(MOBILE.joinpath("src").rglob("*.ts*")):
        source = path.read_text(encoding="utf-8")
        for call in CALL.finditer(source):
            args = call.group("args")
            keys = KEY.findall(args)
            if not keys:
                continue
            line = source.count("\n", 0, call.start()) + 1
            where = f"{path.relative_to(MOBILE)}:{line}"
            # Per KEY rather than per call. `t(a, { x: t(b) })` carries two of
            # them, and only the outer one was handed anything - asking whether
            # the call contains a brace anywhere would clear the inner one too.
            spans = [m.span() for m in KEY.finditer(args)]
            for index, key in enumerate(keys):
                after = spans[index][1]
                upto = spans[index + 1][0] if index + 1 < len(spans) else len(args)
                passed = "{" in args[after:upto]
                value = table.get(key)
                if value is None:
                    problems.append(f"{where}: no such key {key!r}")
                    continue
                wants = set(PLACEHOLDER.findall(value))
                if wants and not passed:
                    problems.append(
                        f"{where}: {key!r} needs {sorted(wants)} and was asked for with none"
                    )

    for problem in problems:
        print(problem)
    print(f"check_keys: {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
