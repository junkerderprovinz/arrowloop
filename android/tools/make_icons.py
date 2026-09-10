# -*- coding: utf-8 -*-
"""Startsymbol und Benachrichtigungssymbol fuer die Android-App.

Beides aus dem VORHANDENEN Werk, nicht neu erfunden: die App traegt dieselbe
Marke wie der Container und der Schreibtisch, sonst sind es fuer den Betrachter
drei Programme.

DREI Symbole, weil Android drei verschiedene Dinge verlangt.

Das ADAPTIVE Symbol ist das, was auf einem Startbildschirm seit Android 8
wirklich gezeigt wird: zwei Ebenen, Hintergrund und Vordergrund, und der
Starter legt seine eigene Maske darueber - beim Standard ein Quadrat mit
runden Ecken. Der Hintergrund ist WEISS, weil jdp genau das verlangt hat
("Das App-Logo soll zudem eine weiße Kachel sein mit abgerundeten ecken (wie
die KL app)") und weil KnightLoaders eigene App es so macht: `adaptiveIcon`
mit `backgroundColor: "#ffffff"`. Ohne adaptives Symbol nimmt der Starter das
alte Vollbild und legt es in einen grauen Kreis oder eine Umrandung seiner
Wahl - was jdp gesehen hat und was neben der KL-App aussieht wie eine App aus
einer anderen Zeit.

Der Vordergrund liegt in der SICHERHEITSZONE. Von den 108 Einheiten eines
adaptiven Symbols sind nur die mittleren 66 garantiert sichtbar; der Rand ist
Spielraum fuer die Maske und fuer die Bewegung, die manche Starter beim
Wischen zeigen. Ein Logo, das die vollen 108 fuellt, wird an den Ecken
abgeschnitten - und zwar unterschiedlich stark je nach Telefon.

Das alte mipmap-Symbol bleibt fuer Android 7 und aelter, das adaptive kennt.
Das Benachrichtigungssymbol wird vom System auf eine SILHOUETTE reduziert:
alles, was nicht durchsichtig ist, wird weiss eingefaerbt. Ein farbiges Logo
dort ergibt einen weissen Klecks, deshalb wird es hier bewusst auf eine
erkennbare Kontur gebracht.
"""
import io
import os
from PIL import Image

QUELLE = r"D:\github\arrowloop\.github\assets\appicon.png"
RES = r"D:\github\arrowloop\android\app\src\main\res"

# Die Dichtestufen, die Android erwartet, mit ihrem Faktor auf 48dp.
DICHTEN = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}

# Ein adaptives Symbol ist 108dp gross. Die mittleren 66dp sind die
# SICHERHEITSZONE - was dort liegt, wird nie abgeschnitten - aber sie ist nicht
# die richtige Groesse fuer die Marke.
#
# Androids eigene Keyline dafuer: eine VOLLFLAECHIGE runde Form soll 60dp
# messen, eine quadratische 44dp. ArrowLoops Marke ist ein Kreis und fuellt
# ihre Vorlage randlos aus, also gilt der Kreiswert. Auf 66dp gebaut sah sie
# entsprechend gross aus, und genau so wurde sie gemeldet ("das logo auf der
# kachel ist zu groß").
#
# 58 statt 60, und das ist gemessen statt geraten: KnightLoaders Marke belegt
# 37% der Breite ihrer Leinwand, weil sie ein hoher schmaler Schild ist. Ein
# Kreis mit demselben optischen Gewicht sitzt unter der Keyline, nicht darauf.
ADAPTIV_DP = 108
MARKE_DP = 58

quelle = Image.open(QUELLE).convert("RGBA")

for name, faktor in DICHTEN.items():
    kante = int(round(48 * faktor))
    ordner = os.path.join(RES, "mipmap-" + name)
    os.makedirs(ordner, exist_ok=True)
    quelle.resize((kante, kante), Image.LANCZOS).save(os.path.join(ordner, "ic_launcher.png"))

    # Der Vordergrund des adaptiven Symbols: durchsichtige 108dp-Flaeche mit
    # dem Logo mittig in den sicheren 66dp. Der Hintergrund ist kein Bild,
    # sondern eine Farbe (siehe values/ic_launcher_background.xml), denn eine
    # einfarbige Flaeche als PNG in fuenf Dichten waere fuenf Dateien fuer
    # etwas, das eine Zeile ist.
    voll = int(round(ADAPTIV_DP * faktor))
    marke = int(round(MARKE_DP * faktor))
    vordergrund = Image.new("RGBA", (voll, voll), (0, 0, 0, 0))
    logo = quelle.resize((marke, marke), Image.LANCZOS)
    versatz = (voll - marke) // 2
    vordergrund.paste(logo, (versatz, versatz), logo)
    vordergrund.save(os.path.join(ordner, "ic_launcher_foreground.png"))

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
