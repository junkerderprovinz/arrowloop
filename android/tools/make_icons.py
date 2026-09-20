# -*- coding: utf-8 -*-
"""Startsymbol und Benachrichtigungssymbol fuer die Android-App, aus appicon.png.

Drei Symbole: das alte mipmap-Symbol fuer Android 7 und aelter, das adaptive
Symbol ab Android 8 (Vordergrund auf weissem Hintergrund, die Maske legt der
Starter darueber) und das Benachrichtigungssymbol, das das System auf eine
Silhouette reduziert.

Von den 108 Einheiten eines adaptiven Symbols sind nur die mittleren 66 sicher
sichtbar; ein Logo, das mehr fuellt, wird je nach Telefon an den Ecken
abgeschnitten.
"""
import io
import os
from PIL import Image

QUELLE = r"D:\github\arrowloop\.github\assets\appicon.png"
RES = r"D:\github\arrowloop\android\app\src\main\res"

# Die Dichtestufen, die Android erwartet, mit ihrem Faktor auf 48dp.
DICHTEN = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}

# Androids Keyline fuer eine vollflaechige runde Form ist 60dp; die Marke bleibt
# knapp darunter, damit der Kreis neben schmalen Marken nicht schwerer wirkt.
ADAPTIV_DP = 108
MARKE_DP = 58

quelle = Image.open(QUELLE).convert("RGBA")

for name, faktor in DICHTEN.items():
    kante = int(round(48 * faktor))
    ordner = os.path.join(RES, "mipmap-" + name)
    os.makedirs(ordner, exist_ok=True)
    quelle.resize((kante, kante), Image.LANCZOS).save(os.path.join(ordner, "ic_launcher.png"))

    # Der Hintergrund ist eine Farbe in values/colors.xml, kein Bild.
    voll = int(round(ADAPTIV_DP * faktor))
    marke = int(round(MARKE_DP * faktor))
    vordergrund = Image.new("RGBA", (voll, voll), (0, 0, 0, 0))
    logo = quelle.resize((marke, marke), Image.LANCZOS)
    versatz = (voll - marke) // 2
    vordergrund.paste(logo, (versatz, versatz), logo)
    vordergrund.save(os.path.join(ordner, "ic_launcher_foreground.png"))

    # 24dp, eine weisse Silhouette aus dem Alphakanal; das System faerbt sie
    # ohnehin um.
    rand = int(round(24 * faktor))
    klein = quelle.resize((rand, rand), Image.LANCZOS)
    alpha = klein.getchannel("A")
    silhouette = Image.new("RGBA", (rand, rand), (255, 255, 255, 0))
    silhouette.putalpha(alpha)
    weiss = Image.new("RGBA", (rand, rand), (255, 255, 255, 255))
    weiss.putalpha(alpha)
    ordner_d = os.path.join(RES, "drawable-" + name)
    os.makedirs(ordner_d, exist_ok=True)
    weiss.save(os.path.join(ordner_d, "ic_notification.png"))

print("Symbole in %d Dichtestufen geschrieben" % len(DICHTEN))
