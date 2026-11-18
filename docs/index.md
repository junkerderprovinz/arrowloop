# ArrowLoop

Two-way file synchronisation that shows you the plan before it moves anything.

Every other sync tool's main screen is a progress bar, which is a report on a
decision somebody already made for you. Here you get the decision: every
proposed change listed with its direction and the reason for it, each row
unticked if you disagree, and nothing touched until you press the button.

It is a self-hosted replacement for [GoodSync](https://www.goodsync.com). The
engine is the part that can lose data, and it is proved on its own; the
scheduler, the job file and the run log are built on top of it.
[How it compares](comparison.md) sets it beside GoodSync and the other tools.

## Download

Every link fetches the newest release. The
[release notes](https://github.com/junkerderprovinz/arrowloop/releases/latest)
say what changed, and the
[releases page](https://github.com/junkerderprovinz/arrowloop/releases) keeps
the older versions.

<div class="al-downloads">
  <div class="al-downloads__row">
    <p class="al-downloads__platform">Windows</p>
    <div class="al-downloads__links">
      <a class="md-button md-button--primary" href="https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-windows-amd64-installer.exe" aria-label="Windows installer">Installer</a>
      <a class="md-button" href="https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-windows-amd64-portable.exe" aria-label="Windows portable">Portable</a>
    </div>
    <p class="al-downloads__note">ARM:
      <a href="https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-windows-arm64-installer.exe" aria-label="Windows on ARM installer">installer</a>,
      <a href="https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-windows-arm64-portable.exe" aria-label="Windows on ARM portable">portable</a></p>
  </div>
  <div class="al-downloads__row">
    <p class="al-downloads__platform">macOS</p>
    <div class="al-downloads__links">
      <a class="md-button md-button--primary" href="https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-macos-universal.dmg" aria-label="macOS disk image">Disk image</a>
      <a class="md-button" href="https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-macos-universal.zip" aria-label="macOS app as a zip">Zip</a>
    </div>
    <p class="al-downloads__note">For Intel and Apple silicon</p>
  </div>
  <div class="al-downloads__row">
    <p class="al-downloads__platform">Linux</p>
    <div class="al-downloads__links">
      <a class="md-button md-button--primary" href="https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-linux-amd64-installer" aria-label="Linux installer">Installer</a>
      <a class="md-button" href="https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-linux-amd64.flatpak" aria-label="Linux Flatpak">Flatpak</a>
      <a class="md-button" href="https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-linux-amd64" aria-label="Linux single file">Single file</a>
    </div>
    <p class="al-downloads__note">ARM:
      <a href="https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-linux-arm64-installer" aria-label="Linux on ARM installer">installer</a>,
      <a href="https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-linux-arm64.flatpak" aria-label="Linux on ARM Flatpak">Flatpak</a>,
      <a href="https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-linux-arm64" aria-label="Linux on ARM single file">single file</a></p>
  </div>
  <div class="al-downloads__row">
    <p class="al-downloads__platform">Android</p>
    <div class="al-downloads__links">
      <a class="md-button md-button--primary" href="https://github.com/junkerderprovinz/arrowloop/releases/latest/download/arrowloop-android-arm64.apk" aria-label="Android APK">APK</a>
      <a class="md-button" href="https://f-droid.org/packages/arrowloop.halleluja.design/">F-Droid</a>
    </div>
    <p class="al-downloads__note">Google Play is coming soon</p>
  </div>
  <div class="al-downloads__row">
    <p class="al-downloads__platform">Docker</p>
    <div class="al-downloads__links">
      <a class="md-button md-button--primary" href="https://hub.docker.com/r/junkerderprovinz/arrowloop">Docker Hub</a>
      <a class="md-button" href="https://raw.githubusercontent.com/junkerderprovinz/arrowloop/main/compose.yaml">Compose file</a>
    </div>
    <p class="al-downloads__note"><code>junkerderprovinz/arrowloop</code></p>
  </div>
  <div class="al-downloads__row">
    <p class="al-downloads__platform">Unraid</p>
    <div class="al-downloads__links">
      <a class="md-button md-button--primary" href="https://ca.unraid.net/apps/arrowloop-04rvnbl1yv3wn1">Community Applications</a>
      <a class="md-button" href="https://raw.githubusercontent.com/junkerderprovinz/arrowloop/main/templates/my-ArrowLoop.xml" aria-label="Unraid template">Template</a>
    </div>
  </div>
  <div class="al-downloads__row">
    <p class="al-downloads__platform">App stores</p>
    <div class="al-downloads__links">
      <a class="md-button" href="https://mos-official.net/apps.html?search=ArrowLoop">MOS</a>
      <a class="md-button" href="https://github.com/junkerderprovinz/zimaos-apps#install">ZimaOS and CasaOS</a>
      <a class="md-button" href="https://github.com/junkerderprovinz/umbrel-apps#install">umbrelOS</a>
    </div>
  </div>
</div>

[Installing](installing.md) explains each one, including the warning Windows
and macOS show on the first start.

## The name

The name is a picture of how it works: two arrows closing a loop. What happens
on one side arrives on the other and comes back, and between the two ends sits
the record of what they last agreed on. That makes three pieces: the two ends,
the state database, and the refusal to apply a reckoning that does not add up.
The third is the one that matters when something goes wrong.

## What makes it different

It keeps a **per-file record of what both sides looked like the last time they
agreed**. Without that third term, "the file is here but not there" is
ambiguous: it means either "created over here" or "deleted over there", and
those two call for opposite actions. Every two-way sync that loses data loses it
there.

It **refuses** rather than guesses. A deletion goes to a trash instead of away.
A run that would delete an implausible share of your files stops and says so. A
side that lists nothing at all is never believed, because a disk that failed to
mount looks exactly like a folder somebody emptied.

It reaches **local folders, network shares, SFTP, S3-compatible storage, WebDAV
clouds such as Nextcloud and OpenCloud, and the other services rclone speaks**,
and to the engine they are all the same thing. [rclone](https://rclone.org) is
compiled in as a library rather than shelled out to, with every backend it
ships, so there is no second executable to keep in step. Services that only
sign in through a browser take a token made once with `rclone authorize`; see
[Configuring a job](configuration.md#services-that-sign-in-through-a-browser).

## Where to go next

- [Installing](installing.md) as a container, a desktop app, an Android app, or
  a single binary.
- [Configuring a job](configuration.md), every setting and what it is for.
- [The interface](interface.md), the preview and the pages around it.
- [Command line](cli.md) for a machine nobody is looking at.
- [How it decides](decisions.md), the table the whole engine rests on.
- [Safety](safety.md), what stops it destroying anything.
- [How it compares](comparison.md) with GoodSync, Syncthing and the rest.
- [How it is tested](testing.md).
- [When something goes wrong](troubleshooting.md).

!!! warning "Without a password, anyone who reaches the interface can drive it"
    It asks for a password once one is set under Settings, Security, or through
    `ARROWLOOP_PASSWORD_HASH`. Until then keep it on your own network, or put it
    behind something that asks who the visitor is. It can start a job that
    deletes files.
