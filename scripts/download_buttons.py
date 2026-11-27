"""The download buttons the README shows, read by gen_download_buttons.py.

Each entry names a button the generator knows and where it leads. The rows,
their order, the colours and the words are the generator's, the same in every
repository.
"""

REPO = "arrowloop"
RELEASE = "https://github.com/junkerderprovinz/arrowloop/releases/latest/download/"

BUTTONS = {
    "windows": RELEASE + "arrowloop-windows-amd64-installer.exe",
    "windows-arm": RELEASE + "arrowloop-windows-arm64-installer.exe",
    "macos": RELEASE + "arrowloop-macos-universal.dmg",
    "macos-zip": RELEASE + "arrowloop-macos-universal.zip",
    "linux": RELEASE + "arrowloop-linux-amd64-installer",
    "linux-arm": RELEASE + "arrowloop-linux-arm64-installer",
    "flatpak": RELEASE + "arrowloop-linux-amd64.flatpak",
    "flatpak-arm": RELEASE + "arrowloop-linux-arm64.flatpak",
    "appimage": RELEASE + "arrowloop-linux-amd64.AppImage",
    "appimage-arm": RELEASE + "arrowloop-linux-arm64.AppImage",
    "unraid": "https://ca.unraid.net/apps/arrowloop-04rvnbl1yv3wn1",
    "mos": "https://mos-official.net/apps.html?search=ArrowLoop",
    "zimaos": "https://github.com/junkerderprovinz/zimaos-apps#install",
    "umbrel": "https://github.com/junkerderprovinz/umbrel-apps#install",
    "truenas-yaml": "https://github.com/junkerderprovinz/truenas-apps#arrowloop",
    "compose": "https://raw.githubusercontent.com/junkerderprovinz/arrowloop/main/compose.yaml",
    "proxmox": "#proxmox-ve",
    "synology": "#synology",
    "qnap": "#qnap",
    "ugreen": "#ugreen",
    # A release's "Source code (zip)" is the whole repository at that tag, and
    # GitHub gives the newest one no fixed address, so this leads to the release
    # that lists it.
    "source": "https://github.com/junkerderprovinz/arrowloop/releases/latest",
    "docs": "https://junkerderprovinz.github.io/arrowloop/",
    "google-play": "https://play.google.com/store/apps/details?id=arrowloop.halleluja.design",
    "f-droid": "https://f-droid.org/packages/arrowloop.halleluja.design/",
    # arm64 only; the x86_64 APK for Chromebooks stays on the release page and
    # in the docs.
    "apk": RELEASE + "arrowloop-android-arm64.apk",
}
