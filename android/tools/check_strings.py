# -*- coding: utf-8 -*-
"""Jede Uebersetzung traegt dieselben Platzhalter wie das Original.

WARUM DAS EINE EIGENE WACHE BRAUCHT. `getString(id, a, b)` fuellt nach
POSITION. Eine Uebersetzung, die einen Platzhalter weniger hat als das
Original, wirft die uebrigen Argumente stillschweigend weg - kein Absturz,
keine Warnung, nur ein Satz, in dem das Falsche steht.

Genau so ist es passiert: `engine_silent` bekam einen zweiten Platzhalter fuer
die Wartezeit, die deutsche Fassung behielt ihren einen, und der
Fehlerbildschirm zeigte auf dem Telefon die Zahl **60** an der Stelle, an der
das Protokoll haette stehen sollen. Der Bildschirm, dessen einzige Aufgabe es
ist zu erklaeren, warum der Motor nicht anlief, erklaerte also nichts - und
zwar drei Tage lang, ohne dass irgendetwas rot geworden waere.

Android Studios Lint kennt diese Pruefung als StringFormatMatches. Der Bau
hier laesst Lint nicht laufen, weil ein voller Lint-Durchgang ueber ein
Gradle-Projekt eine Menge Meinungen mitbringt, die mit Richtigkeit nichts zu
tun haben. Diese Datei prueft das eine, was hier schon einmal falsch war.

Geprueft wird ausserdem, dass eine Uebersetzung keinen Schluessel erfindet, den
das Original nicht kennt: so einer wird nie gelesen und ist damit Text, der
gepflegt wird und niemanden erreicht.

Fehlende Schluessel sind KEIN Fehler. Android faellt fuer die auf values/
zurueck, und eine noch nicht uebersetzte Zeile auf Englisch zu sehen ist
richtig - sie wird nur gezaehlt und genannt.
"""
import io
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

# Which resource tree to check, because there are two: the old WebView shell's
# and the React Native app's, which the config plugin copies out of
# mobile/native/res. The mobile workflow was pointing this at the shell, so the
# guard was reading the strings of an app nobody installs any more - a check
# that cannot reach the failure reports nothing.
DEFAULT_RES = Path(__file__).parent.parent / "app" / "src" / "main" / "res"

# `%1$s`, `%2$d`, und das blosse `%s` ohne Nummer, das Android ebenfalls nimmt.
PLACEHOLDER = re.compile(r"%(\d+\$)?[a-zA-Z]")


def strings(path):
    """Schluessel -> Text, aus einer strings.xml."""
    root = ET.fromstring(io.open(path, encoding="utf-8").read())
    return {el.get("name"): "".join(el.itertext()) for el in root.iter("string")}


def marks(text):
    """Die Platzhalter eines Textes, als Menge.

    Als MENGE und nicht als Liste, weil eine Uebersetzung dieselbe Zahl an
    einer anderen Stelle im Satz brauchen darf - und auch zweimal. Was nicht
    sein darf, ist ein Platzhalter, den es im Original nicht gibt, oder einer
    aus dem Original, den die Uebersetzung fallen laesst.
    """
    return {m.group(0) for m in PLACEHOLDER.finditer(text)}


def main():
    res = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_RES
    # The shell writes values/strings.xml; the config plugin writes
    # values/strings_engine.xml so its own file cannot collide with the one
    # prebuild generates. Either is the original.
    base = next(iter(sorted(res.glob("values/strings*.xml"))), None)
    if base is None or not base.is_file():
        raise SystemExit("kein values/strings*.xml unter %s" % res)
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
                    "%s: %s gibt es in values/ nicht - diese Zeile wird nie gelesen"
                    % (folder.name, key)
                )
                continue
            checked += 1
            want, have = marks(original[key]), marks(text)
            if want != have:
                problems.append(
                    "%s: %s hat %s, das Original hat %s"
                    % (folder.name, key, sorted(have) or "keine Platzhalter", sorted(want) or "keine")
                )
        print("%s: %d Schluessel geprueft, %d fehlen (fallen auf values/ zurueck)%s"
              % (folder.name, len(translated), len(missing),
                 ": " + ", ".join(missing) if missing else ""))

    if problems:
        print()
        for line in problems:
            print("  " + line)
        raise SystemExit("\n%d Fehler in den Uebersetzungen" % len(problems))
    print("%d uebersetzte Schluessel, alle Platzhalter passen" % checked)


if __name__ == "__main__":
    main()
