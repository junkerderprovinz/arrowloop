# Installing

## As a container

```bash
docker run -d --name arrowloop -p 8422:8422 \
  -v /mnt/user/appdata/arrowloop:/config \
  -v /mnt/user:/data \
  junkerderprovinz/arrowloop:latest
```

`/config` holds `arrowloop.json`, one state database per job, and the run log.

!!! danger "/config has to survive the container"
    Those state databases are what let the engine tell a new file from a deleted
    one. Lose them and every job forgets what the two sides agreed on and treats
    every file on both sides as new: nothing is destroyed, but a great deal is
    copied, and a deletion made while the record was missing is propagated to
    nobody.

A first start on an empty `/config` writes a starter configuration with no
jobs, so the interface comes up and can be edited rather than
crash-looping on a missing file.

### A password for the interface

The container listens on every address, so anyone on the network who reaches
port 8422 can start a job. Set a password under **Settings**, **Security**, and
from then on every page but the login asks for it.

The same section sets up a second factor: six digits from an authenticator app
on top of the password. Setting it up shows eight recovery codes once, and each
of them signs in a single time in place of a code.

It also registers passkeys, a key on a phone, a laptop or a security stick used
instead of typing the password. A browser offers one only on a host name over
HTTPS with a certificate it trusts, or on `localhost`, so on
`http://192.168.1.5:8422` the section explains why it cannot. Behind a reverse
proxy with a real name they work, and each key belongs to the address it was
registered on.

All three are kept in `/config/security.json`, readable by its owner only, and
never in `arrowloop.json`. That file is downloaded whole as a settings backup and
replaced whole by a restore, so a hash in it would leave with every backup and
restoring an old one would switch the password off.

#### The environment variable

`ARROWLOOP_PASSWORD_HASH` still works, and it wins over the password set in the
interface, which then shows the password as set from outside and offers no form
for it. That makes it the way back in after a forgotten password. Have the image
hash one and hand the result back:

```bash
docker run --rm -it junkerderprovinz/arrowloop:latest hash-password

docker run -d --name arrowloop -p 8422:8422 \
  -e ARROWLOOP_PASSWORD_HASH='$2a$10$...' \
  ...
```

The single quotes matter: the hash is full of `$`, which a shell would otherwise
read as variables. In a Compose file, write every `$` as `$$`.

If the authenticator app and the recovery codes are both gone, stop the
container and delete `/config/security.json`. That removes the password, the
second factor and the passkeys together. A damaged `security.json` stops the
container from starting rather than letting it come up without a password; the
log names the file, and deleting it has the same effect.

### On Unraid

The template is
[`templates/my-ArrowLoop.xml`](https://github.com/junkerderprovinz/arrowloop/blob/main/templates/my-ArrowLoop.xml).
Drop it into `/boot/config/plugins/dockerMan/templates-user/` and it appears in
the Docker tab's Add Container list, with every field editable. Most installs
set the password in the interface; the template's masked password hash field
is the environment variable above, and its text says how to fill it from the
container's console.

Mount the data path read-write. A two-way job writes to both sides by
definition, and a read-only mount produces a job that fails on every run for a
reason that reads like a bug.

## As a desktop application

Windows, Linux and macOS builds are on the
[releases page](https://github.com/junkerderprovinz/arrowloop/releases). Windows
gets an **installer** that gives it an entry under Apps. It installs for all
users under `C:\Program Files\ArrowLoop` and asks for an administrator once,
while it installs; later updates ask nobody (see [Updates](#updates)). A page
asks whether you want a Start menu entry and a desktop shortcut, both ticked at
first, and both go to every user on the computer. The next install, silent or
not, starts from your answer and removes a shortcut you left out.

The installer also cleans up after older versions. The copy 1.2.0 installed for
you alone under `AppData\Local\Programs` goes, with its shortcuts and its entry
under Apps, and so does an installation for all users from 1.1.0 or earlier. It
never touches your settings and jobs in `%APPDATA%\ArrowLoop`. A 1.2.0
installation that you leave alone keeps updating itself where it is; running
the new installer once moves it.

Run as `installer.exe /S /relaunch`, it installs silently and starts ArrowLoop
again, as the person signed in, when it is done. A computer with an ARM
processor, such as a Snapdragon laptop, takes the one named `windows-arm64`; the
`amd64` installer would run there too, but through emulation and slower.

It is not a client talking to a server. The scheduler, the run log and the API
all live in the same process, and the window is a webview pointed at them.
Nothing listens on the network at all, which is the difference between a desktop
application and a server nobody asked to run.

The schedules run for as long as the window is open. For a machine that should
sync while nobody is looking, use `arrowloop daemon` and `arrowloop service`
instead; see [the command line](cli.md).

### Starting with the system

Settings, General, Starting has a switch that registers ArrowLoop to start when
you sign in. It is a **per-user** entry (a value under `HKCU` on Windows, a
`.desktop` file under `~/.config/autostart` on Linux, a LaunchAgent in your own
Library on macOS), so it needs no administrator rights and affects nobody else on
the machine.

Started this way, ArrowLoop stays in the notification area, because nobody is
waiting for a window when the session starts. It also comes back there after
something outside ended it while its window was in the notification area, as an
update does. Starting it by hand opens the window, and so does every start after
you quit it.

The switch reads its state back from the system rather than from a settings file,
so removing the entry with the Task Manager's own Startup tab turns the switch
off too, instead of leaving it claiming something that is no longer true.

Autostart on its own only gets the program running. A job that should sync
*because* the machine just came on wants `runAtStart` as well, or it will sit
there until its schedule is next due; see
[the configuration reference](configuration.md#running-at-start).

### The notification area

It puts an icon in the notification area. A click on it opens a small window
beside the icon with what is running now, the last five runs, and buttons to
pause, to sync everything and to open ArrowLoop. A second click or a click
elsewhere closes it, and a double click opens the main window. The right-click
menu has:

- **Open**, which brings the main window back.
- **Force sync**, which starts every job straight away, as if you had started
  each one by hand, so no pause and no battery setting holds it.
- **Pause sync** or **Resume sync**. A pause holds every scheduled and watching
  run until you resume, stops the runs already going, and stays after a
  restart. The icon turns grey with a pause badge while it lasts.
- **Quit**.

The menu and the small window speak the language the interface is set to.

Settings, General decides what the window buttons do: whether closing quits or
hides, and whether minimising goes to the taskbar or to the notification area.
Closing quits by default, because a close button that quietly leaves a program
running is the kind of surprise somebody finds a week later. Both choices switch
off together with the icon, since a window that hides with nothing left to bring
it back is gone. Switching the icon off or on applies at once.

Starting it a second time does not start a second copy. It brings the running
window back, which is what a second double-click means when the first one is
sitting in the notification area.

### Updates

The desktop app updates itself from GitHub. It asks for the newest release,
downloads the file for your system in the background and checks it against the
release's `checksums.txt`. The new version starts the next time you start
ArrowLoop, so a sync that is running is never cut off, and a note in the corner
of the window says when it is ready. Pre-releases are never installed.
**Update automatically** under Settings, General, Updates turns this off; it is
on from the start. The container and the phone do not show the switch: a
container is updated the way it was deployed, and the phone through its store
or a new APK.

**The installed copy** under Program Files cannot replace itself, since no user
may write there. A scheduled task named **ArrowLoop Update** does it instead,
once a day and five minutes after the computer starts, whether ArrowLoop is
open or not. It replaces `ArrowLoop.exe`, sets the version shown under Apps and
writes what it did, or why it did not, to `%ProgramData%\ArrowLoop\update.log`.
There is one installation, so the switch applies to everyone on the computer:
it lives in `%ProgramData%\ArrowLoop\settings.json`, which every user may
change, and the task skips its run while it is off. An open window notices
within a few minutes when the task has put a new version in place and shows
the note. The replaced program waits beside the new one as `ArrowLoop.exe.old`
until a later run removes it.

**A portable copy**, such as the `arrowloop-windows-amd64-portable.exe` from the
releases page, updates itself while it runs: a minute after it starts and once
a day after that, in its own folder, and it stays portable. The app on macOS
and Linux does the same. A folder it cannot write to, or a macOS app your
account cannot change, stays as it is. Its log is `update.log` beside the
configuration file.

#### Why the task runs as SYSTEM

Program Files belongs to the administrators. A program that replaces itself
there without asking anyone needs an account that may write there, and a
scheduled task under the system account is how Windows provides one; Firefox's
maintenance service and Chrome's updater task work the same way. The task
writes to three places and nowhere else: the installation folder,
`C:\Program Files\ArrowLoop`; the entry under Apps, in
`HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\ArrowLoop`; and
`%ProgramData%\ArrowLoop`, for its log. It reads nothing from any user's
profile. The folder under ProgramData belongs to the administrators, and only
`settings.json` in it is open to other users. The installer has no page for
choosing another folder. Together that leaves no file a user could swap for
one the system account would run or write to. It downloads only from GitHub
over HTTPS and installs a file only when it matches `checksums.txt`.

#### Uninstalling

Apps, ArrowLoop, Uninstall asks for an administrator and removes the program,
its shortcuts and its entry, the scheduled task and `%ProgramData%\ArrowLoop`
with the switch and the log. The webview cache of the person uninstalling goes
as well. Every user's settings and jobs in `%APPDATA%\ArrowLoop` stay, so a
later install picks them up.

#### Trying it locally

A build from source is not a release and never updates itself. Only a build of a
version tag, stamped by `scripts/desktop.mjs` as the release workflow makes it,
does. Built with `-tags updatetest`, the app reads `ARROWLOOP_UPDATE_API`, a
stand-in for `https://api.github.com`, and `ARROWLOOP_UPDATE_DELAY`, the wait
before the first check (such as `15s`), so the whole path can be tried locally.
`node scripts/desktop.mjs --installer --updatetest` builds an installer for
such a build. It installs as **ArrowLoop Test**, with a task and a folder under
ProgramData of that name, beside a real installation. Its task starts without
your environment and reads the stand-in's address from `updatetest-api` in
`%ProgramData%\ArrowLoop Test`. Release builds leave the tag out, so nothing on
the computer can change where an update comes from.

!!! note "The builds are not signed"
    Windows shows its blue warning on first start (More info, then Run anyway),
    and macOS needs a right-click and Open the first time. That is a deliberate
    trade for now: a certificate is a recurring cost, and it is worth paying
    once there are users to pay it for. For the same reason an update is
    checked only against the release's `checksums.txt`, which proves the file
    is the one the release published, not who built it.

## As a single binary

```bash
go build ./cmd/arrowloop
```

The result needs nothing else installed. It carries the interface, the engine
and every storage backend it supports.

## Syncing between two places over the internet

ArrowLoop connects to the other side itself, over SFTP, SMB, WebDAV or a
cloud's own interface. It has no relay and no account of its own, so a laptop
away from home reaches the server at home only if that server can be reached.
Opening its SSH port to the internet is the way not to do that.

Put both machines in one private network instead:

- **Tailscale** is the quickest. Install it on both machines and they reach
  each other by name, from anywhere, with no port forwarded. It needs a
  Tailscale account, its coordination servers introduce the machines, and its
  relays carry the traffic when no direct path exists. That is the same trade
  Syncthing and Resilio make, taken once for every program rather than per
  program. [Headscale](https://github.com/juanfont/headscale) runs the
  coordination on your own server.
- **WireGuard** on its own needs nobody else's server, but one UDP port
  forwarded on the router at home.

Then add the server in ArrowLoop as usual, under Targets, Add a server or
share, with its name or address inside that network as the host: with
Tailscale, the machine name it shows (`server` or
`server.your-tailnet.ts.net`); with WireGuard, the address the tunnel gives it.
A job between the laptop and that target then runs the same at home and away.
While the laptop has no connection, its scheduled runs fail and say so, and
the next one that gets through catches up.
