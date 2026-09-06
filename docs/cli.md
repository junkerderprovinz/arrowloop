# Command line

```
arrowloop sync     -left <path> -right <path> -state <db>   run one pair once
arrowloop run      -config <file> <job>                     run one named job now
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

Both sides accept anything rclone accepts.

| flag | default | meaning |
|---|---|---|
| `-quiet-period` | 5s | how long a file must sit unchanged before it is touched |
| `-exclude` | - | glob to leave alone entirely, repeatable |
| `-no-default-excludes` | off | also sync half-written files |
| `-transfers` | 4 | files copied at the same time |
| `-bwlimit` | - | rclone syntax, `1M` or a timetable |
| `-empty-dirs` | off | carry folders that hold no files |
| `-metadata` | off | carry permissions and extended attributes |
| `-brake-percent` | 50 | refuse a run deleting more than this share, 0 disables |
| `-brake-floor` | 10 | never trip the brake below this many deletions |
| `-mod-window` | 2s | how far modification times may differ and still count as equal |
| `-v` | off | let rclone report what it is doing underneath |

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
deletes files and has no login of its own, so making it reachable has to be a
decision somebody took on purpose.

`daemon` is the same scheduler with no interface, for a machine where nobody is
looking.

## service

Prints the file this operating system wants in order to keep the daemon alive,
and the one command that switches it on. It prints rather than installs:
registering a service means writing outside your own files and, on two of the
three systems, asking for administrative rights.

```bash
arrowloop service -config /etc/arrowloop/arrowloop.json
arrowloop service -os windows
```

Three things it tells you that are otherwise found out the hard way:

- A Windows service runs as LocalSystem, which has no mapped network drives. A
  job pointing at a UNC path works; one pointing at a drive letter does not.
- A Linux user service needs `loginctl enable-linger` to survive a logout.
- macOS asks for permission the first time the agent touches Documents, and
  until that is granted the job fails with an ordinary permission error that
  looks like a bug and is not one.

## version

Prints which build this binary is, and nothing else, so it can be read from a
script.

```bash
arrowloop version
```

A release build prints its tag, a build from a commit prints the commit, and a
build from an edited tree adds `-dirty`, because a binary from uncommitted
changes is not the commit it names. An unstamped local `go build` prints `dev`.

The desktop application answers the same question through the Windows file
properties dialog and on its About card. This command exists because a Go binary
carries no version resource, so the properties dialog has nothing to show for
this one.
