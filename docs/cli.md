# Command line

```
arrowloop sync     -left <path> -right <path> -state <db>   run one pair once
arrowloop run      -config <file> <job>                     run one named job now
arrowloop run-due  -config <file>                           run every job that is due, then exit
arrowloop web      -config <file>                           serve the interface, schedules included
arrowloop daemon   -config <file>                           run every scheduled job, no interface
arrowloop jobs     -config <file>                           what is configured, and when each last worked
arrowloop history  -config <file> [-job <name>]             what the runs did
arrowloop service  [-config <file>] [-os <goos>]            the service file for this system
arrowloop version                                           which build this is
```

Every command takes `-h` for its own flags.

## sync

The shape for setting a job up: nothing to write to disk first, and `-dry-run`
to see what would happen before anything does.

```bash
arrowloop sync -left /data/Photos -right sftp:backup/photos -state photos.db -dry-run
```

`-dry-run` prints the plan and changes nothing. Both sides accept anything
rclone accepts, so `sftp:backup/photos` and `s3:bucket/photos` work alongside
plain paths.

| flag | default | meaning |
|---|---|---|
| `-quiet-period` | 5s | how long a file must sit unchanged before it is touched, 0 disables |
| `-exclude` | - | glob of paths to leave alone entirely, repeatable |
| `-include` | - | glob of the only files to sync, repeatable |
| `-no-default-excludes` | off | also sync half-written files such as `*.part` and Office owner files |
| `-transfers` | 4 | how many files may be copied at the same time |
| `-bwlimit` | - | bandwidth limit in rclone syntax, `1M` or a timetable like `08:00,512k 19:00,off` |
| `-empty-dirs` | off | also carry folders that hold no files |
| `-metadata` | off | carry permissions, ownership and extended attributes where both sides can |
| `-brake-percent` | 50 | refuse a run deleting more than this share of known files, 0 disables |
| `-change-percent` | 50 | refuse a run overwriting more than this share of known files, 0 disables |
| `-brake-floor` | 10 | never trip a brake below this many deletions or overwrites |
| `-mod-window` | 2s | how far modification times may differ and still count as equal |
| `-v` | off | let rclone report what it is doing underneath |

The modification window only ever applies when a side cannot produce a hash.
Where hashes exist the comparison is exact, because with a two-second window a
file edited twice within two seconds and left at the same length would count as
unchanged.

## jobs

Reports when each job last **succeeded**, not when it last ran.

"When did this last run" is the easy question. A job failing every quarter of an
hour for a week looks busy in a log while being of no use at all.

## web and daemon

`web` serves the interface and runs the schedules in the same process. One
process rather than two: a browser tab that could start a job but could not see
the scheduled ones would be lying by omission, and two processes sharing one
state database is the sort of arrangement that works until the day both happen
to run the same job.

It listens on loopback unless told otherwise. The interface can start a job that
deletes files and asks for no password until one is set under Settings,
Security, or through `ARROWLOOP_PASSWORD_HASH`, so making it reachable has to be
a decision somebody took on purpose. The password is optional. Without it
anyone who reaches the port can do everything, and
[installing](installing.md#a-password-for-the-interface) says what one
protects. What the interface sets is kept in `security.json` beside the
configuration file.

`daemon` is the same scheduler with no interface, for a machine where nobody is
looking. It trims the run log once as it starts, keeping what `historyKeep` in
the configuration asks for; `-keep-history` sets another age for that start,
and `0` keeps every record.

## run-due

Runs every job that is due, one after another, and exits. For a machine where
cron, Task Scheduler or a systemd timer starts ArrowLoop now and then, instead
of ArrowLoop staying up all day.

"Due" is decided the way the daemon decides it. A scheduled job is due when its
last scheduled time has passed since it last worked, and a job that has never
run is due straight away. A job that failed waits out its retry pause before it
is tried again. Jobs without a schedule and paused jobs are left alone. So the
timer only has to come round at least as often as your most frequent schedule:
with a timer every 15 minutes, a job set for 03:00 runs between 03:00 and 03:15.

Each job gets one line on standard output, and the log goes to standard error,
so `run-due > results.txt` keeps the results apart:

```text
Fotos: 12 copied, 0 moved, 1 trashed, 0 conflicts, 0 folders made, 0 folders removed, 4810 unchanged, 0 left for later, in 3.2s
Music: skipped, another ArrowLoop is running this job right now
Backup: failed, the command before the run failed, so the run did not start: exit status 1
```

| exit status | meaning |
|---|---|
| 0 | every due job worked, was skipped, or nothing was due |
| 1 | at least one job failed |
| 2 | the command line was wrong, such as an unknown flag |
| 130, 143 | Ctrl+C or a stop from the service manager ended it |

A stop lets the run in progress unwind, and its history records it as stopped.

A job another ArrowLoop is running at that moment is skipped. That covers the desktop app open in the tray, a daemon, or a second
`run-due` the timer started while the first was still busy. Each run holds a
lock on a file beside the job's state database, and the system lets go of it
when the process ends, even one that crashed.

## From the desktop app

The desktop app understands the same commands. Started with a command as its
first argument it runs that command and exits, with no window and no tray icon,
and it leaves a copy that is already open alone. `-config` defaults to the
app's own configuration, so these work as they are:

```sh
ArrowLoop jobs
ArrowLoop history -job Fotos
ArrowLoop run Fotos
ArrowLoop run-due
```

Where the program and its configuration are:

| system | program | configuration |
|---|---|---|
| Windows | `C:\Program Files\ArrowLoop\ArrowLoop.exe` | `%APPDATA%\ArrowLoop\arrowloop.json` |
| Linux | `~/.local/share/com.junkerderprovinz.arrowloop/ArrowLoop` | `~/.config/ArrowLoop/arrowloop.json` |
| Flatpak | `flatpak run io.github.junkerderprovinz.arrowloop` | `~/.var/app/io.github.junkerderprovinz.arrowloop/config/ArrowLoop/arrowloop.json` |
| macOS | `/Applications/ArrowLoop.app/Contents/MacOS/ArrowLoop` | `~/Library/Application Support/ArrowLoop/arrowloop.json` |

The Linux and macOS programs need the libraries their window uses even for a
command. A server without a desktop is better served by the `arrowloop` binary
or the container.

On Windows the app is a window program, which cmd and PowerShell do not wait
for: the prompt comes back at once and the output follows it. `start /wait`
waits in cmd, and in PowerShell piping the output anywhere does:

```bat
start /wait "" "C:\Program Files\ArrowLoop\ArrowLoop.exe" jobs
```

```powershell
& "C:\Program Files\ArrowLoop\ArrowLoop.exe" jobs | Out-Host
```

Task Scheduler waits either way and records the exit status.

### On a timer

Every 15 minutes with cron, keeping a log:

```sh
*/15 * * * * $HOME/.local/share/com.junkerderprovinz.arrowloop/ArrowLoop run-due >> $HOME/.cache/arrowloop-run-due.log 2>&1
```

Every 15 minutes with Windows Task Scheduler, as you, while you are signed in,
which is when your `%APPDATA%` and mapped drives are there:

```bat
schtasks /Create /TN "ArrowLoop run-due" /SC MINUTE /MO 15 /TR "\"C:\Program Files\ArrowLoop\ArrowLoop.exe\" run-due"
```

With a systemd user timer, two files in `~/.config/systemd/user/`.
`arrowloop-run-due.service`:

```ini
[Unit]
Description=ArrowLoop: run the jobs that are due

[Service]
Type=oneshot
ExecStart=%h/.local/share/com.junkerderprovinz.arrowloop/ArrowLoop run-due
```

`arrowloop-run-due.timer`:

```ini
[Unit]
Description=ArrowLoop: look for due jobs every 15 minutes

[Timer]
OnCalendar=*:0/15
Persistent=true

[Install]
WantedBy=timers.target
```

```sh
systemctl --user enable --now arrowloop-run-due.timer
```

`Persistent=true` catches up a turn the computer slept through. As with the
service below, `loginctl enable-linger` keeps the timer going after you log out.

## service

Prints the file this operating system wants in order to keep the daemon alive,
and the one command that switches it on: a systemd unit file on Linux, a
LaunchAgent plist on macOS, and an `sc.exe` line on Windows. It prints rather
than installs: registering a service means writing outside your own files and,
on two of the three systems, asking for administrative rights.

```bash
arrowloop service -config /etc/arrowloop/arrowloop.json
arrowloop service -os windows
```

What it tells you that is otherwise found out the hard way:

- A Windows service runs as LocalSystem, which has no mapped network drives. A
  job pointing at a UNC path works; one pointing at a drive letter does not.
- LocalSystem also runs the jobs' before and after commands. Register a copy of
  the program under Program Files and a configuration file an administrator
  created, not the desktop app's copy under AppData or a file in a user's
  profile: whoever can change either file can run anything as LocalSystem.
- A Linux user service needs `loginctl enable-linger` to survive a logout.
- macOS asks for permission the first time the agent touches Documents, and
  until that is granted the job fails with an ordinary permission error that
  looks like a bug and is not one.

## hash-password

Prints the value `ARROWLOOP_PASSWORD_HASH` wants. The interface sets its own
password without it; the variable is for a password managed from outside, such
as in a container template, and it wins over the one set in the interface,
which makes it the way back in after that one is forgotten. Like the
interface, it takes a password of any length.

The hash is made under the key of the install whose configuration `-config`
names, so run it where that install runs; in the container that is
`-config /config/arrowloop.json`. Without a configuration there it refuses,
unless `ARROWLOOP_APP_KEY` names the key.

At a terminal it asks for the password twice without echoing it; piped, it
takes the first line.

```bash
arrowloop hash-password -config /config/arrowloop.json
printf '%s\n' "$PASSWORD" | arrowloop hash-password -config /config/arrowloop.json
```

The password never goes on the command line, where it would end up in a shell
history and in the process list.

## version

Prints which build this binary is, and nothing else, so it can be read from a
script.

```bash
arrowloop version
```

A release build prints its tag, a build from a commit prints the commit, and a
build from an edited tree adds `-dirty`, because a binary from uncommitted
changes is not the commit it names. An unstamped local `go build` prints `dev`.

The desktop application answers the same question in two more places: under
**Product version** in the Windows file properties dialog, and on its About
card. All three read one stamp, so they cannot disagree. This command exists
because a Go binary carries no version resource, so the properties dialog has
nothing to show for this one.
