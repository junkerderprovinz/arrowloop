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

RES = Path(__file__).parent.parent / "app" / "src" / "main" / "res"

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
    base = RES / "values" / "strings.xml"
    if not base.is_file():
        raise SystemExit("kein values/strings.xml unter %s" % RES)
    original = strings(base)

    problems = []
    checked = 0
    for folder in sorted(RES.glob("values-*")):
        path = folder / "strings.xml"
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
