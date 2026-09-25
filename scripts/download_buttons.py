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
    "linux": RELEASE + "arrowloop-linux-amd64",
    # A browser cannot download an image, so this opens its Docker Hub page,
    # which carries the pull command and every tag.
    "docker": "https://hub.docker.com/r/junkerderprovinz/arrowloop/",
    # A release's "Source code (zip)" is the whole repository at that tag, and
    # GitHub gives the newest one no fixed address, so this leads to the release
    # that lists it.
    "source": "https://github.com/junkerderprovinz/arrowloop/releases/latest",
    "docs": "https://junkerderprovinz.github.io/arrowloop/",
    # No listing yet, so the button is drawn without a link, as the App tab
    # marks the listing "soon". The listing's address goes here once it exists.
    "google-play": None,
    # arm64 only; the x86_64 APK is for emulators and stays on the release page.
    "apk": RELEASE + "arrowloop-android-arm64.apk",
}
