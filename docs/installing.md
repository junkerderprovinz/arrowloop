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

### On Unraid

The template is
[`templates/my-ArrowLoop.xml`](https://github.com/junkerderprovinz/arrowloop/blob/main/templates/my-ArrowLoop.xml).
Drop it into `/boot/config/plugins/dockerMan/templates-user/` and it appears in
the Docker tab's Add Container list, with every field editable.

Mount the data path read-write. A two-way job writes to both sides by
definition, and a read-only mount produces a job that fails on every run for a
reason that reads like a bug.

## As a desktop application

Windows, Linux and macOS builds are on the
[releases page](https://github.com/junkerderprovinz/arrowloop/releases).

It is not a client talking to a server. The scheduler, the run log and the API
all live in the same process, and the window is a webview pointed at them.
Nothing listens on the network at all, which is the difference between a desktop
application and a server nobody asked to run.

The schedules run for as long as the window is open. For a machine that should
sync while nobody is looking, use `arrowloop daemon` and `arrowloop service`
instead; see [the command line](cli.md).

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
