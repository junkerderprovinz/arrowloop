# Installing

## As a container

```bash
docker run -d --name arrowloop -p 8422:8422 \
  -v /mnt/user/appdata/arrowloop:/config \
  -v /mnt/user:/data \
  ghcr.io/junkerderprovinz/arrowloop:latest
```

`/config` holds `arrowloop.json`, one state database per job, and the run log.

!!! danger "/config has to survive the container"
    Those state databases are what let the engine tell a new file from a deleted
    one. Lose them and every job forgets what the two sides agreed on and treats
    every file on both sides as new: nothing is destroyed, but a great deal is
    copied, and a deletion made while the record was missing is propagated to
    nobody.

A first start on an empty `/config` writes a starter configuration with one
disabled example job, so the interface comes up and can be edited rather than
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
docker run --rm -it ghcr.io/junkerderprovinz/arrowloop:latest hash-password

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
gets two files and they are the same program: an **installer** that puts it in
the Start menu and gives it an entry under Apps, and a **portable** exe that runs
from wherever you leave it. Take the installer unless you have a reason not to.
A computer with an ARM processor, such as a Snapdragon laptop, takes the pair
named `windows-arm64`; the `amd64` files would run there too, but through
emulation and slower.

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

The switch reads its state back from the system rather than from a settings file,
so removing the entry with the Task Manager's own Startup tab turns the switch
off too, instead of leaving it claiming something that is no longer true.

Autostart on its own only gets the program running. A job that should sync
*because* the machine just came on wants `runAtStart` as well, or it will sit
there until its schedule is next due; see
[the configuration reference](configuration.md#running-at-start).

It puts an icon in the notification area, and Settings, General decides what
the window buttons do: whether closing quits or hides, and whether minimising goes
to the taskbar or to the notification area. Closing quits by default, because a
close button that quietly leaves a program running is the kind of surprise
somebody finds a week later. Both choices switch off together with the icon,
since a window that hides with nothing left to bring it back is gone.

Starting it a second time does not start a second copy. It brings the running
window back, which is what a second double-click means when the first one is
sitting in the notification area.

!!! note "The builds are not signed"
    Windows shows its blue warning on first start (More info, then Run anyway),
    and macOS needs a right-click and Open the first time. That is a deliberate
    trade for now: a certificate is a recurring cost, and it is worth paying
    once there are users to pay it for.

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
