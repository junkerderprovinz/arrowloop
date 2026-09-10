# -*- coding: utf-8 -*-
"""Startsymbol und Benachrichtigungssymbol fuer die Android-App.

Beides aus dem VORHANDENEN Werk, nicht neu erfunden: die App traegt dieselbe
Marke wie der Container und der Schreibtisch, sonst sind es fuer den Betrachter
drei Programme.

Zwei Symbole, weil Android zwei verschiedene Dinge verlangt. Das Startsymbol
ist das Bild in voller Farbe. Das Benachrichtigungssymbol wird vom System auf
eine SILHOUETTE reduziert: alles, was nicht durchsichtig ist, wird weiss
eingefaerbt. Ein farbiges Logo dort ergibt einen weissen Klecks, deshalb wird
es hier bewusst auf eine erkennbare Kontur gebracht.
"""
import io
import os
from PIL import Image

QUELLE = r"D:\github\arrowloop\.github\assets\appicon.png"
RES = r"D:\github\arrowloop\android\app\src\main\res"

# Die Dichtestufen, die Android erwartet, mit ihrem Faktor auf 48dp.
DICHTEN = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}

quelle = Image.open(QUELLE).convert("RGBA")

for name, faktor in DICHTEN.items():
    kante = int(round(48 * faktor))
    ordner = os.path.join(RES, "mipmap-" + name)
    os.makedirs(ordner, exist_ok=True)
    quelle.resize((kante, kante), Image.LANCZOS).save(os.path.join(ordner, "ic_launcher.png"))

    # Das Benachrichtigungssymbol misst 24dp und ist eine Maske. Aus dem
    # Alphakanal der Vorlage wird eine weisse Silhouette: was gezeichnet ist,
    # wird weiss, der Rest bleibt durchsichtig. Das System faerbt es danach
    # ohnehin um, also ist jede Farbe hier verschwendet - und ein volles Logo
    # ergaebe eine unlesbare Flaeche.
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
