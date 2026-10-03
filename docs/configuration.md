# Configuring a job

A shell history is not a place to keep jobs. Somebody with a photo folder, a
documents folder and a server backup has three of them, each with its own
schedule, its own filters and its own idea of what may be deleted, so everything
past `arrowloop sync` works from a configuration file.

Jobs live in `arrowloop.json`. The jobs tab in the interface writes the same
file, through the same validator, so neither way can produce something the other
refuses. A complete example is
[arrowloop.example.json](https://github.com/junkerderprovinz/arrowloop/blob/main/arrowloop.example.json).

```json
{
  "bwlimit": "",
  "parallelJobs": 1,
  "notify": {
    "matrix": { "homeserver": "https://matrix.example.org", "room": "!abc:example.org", "token": "syt_..." },
    "onSuccess": false
  },
  "jobs": [
    {
      "name": "photos",
      "left": "/data/Photos",
      "right": "sftp:backup/photos",
      "state": "state/photos.db",
      "schedule": "*/15 * * * *",
      "watch": true,
      "exclude": ["*.xmp", "**/.thumbnails/**"],
      "emptyDirs": true
    }
  ]
}
```

Everything is checked when the file is read, including cron expressions,
durations and **misspelled field names**. A program that runs unattended has to
fail on a typo when it starts, not at three in the morning on the one job that
mattered. JSON normally ignores a field it does not recognise, so `"excludes"`
instead of `"exclude"` would leave the filter empty and sync exactly the files
you thought you had excluded; an unknown field is refused instead. The one
exception is a retired field that older versions wrote, such as `firstRun`,
which is dropped rather than refused. Two engine-wide durations, `retry.wait`
and `historyKeep`, fall back to their defaults instead, so a typo there cannot
switch off retries or the trimming of the run log.

Paths resolve against the file itself, not against whatever directory a service
manager happened to start the process in.

## Per job

| Field | Default | What it does |
|---|---|---|
| `name` | required | How the job is asked for and how its history is kept apart. Two jobs cannot share one. |
| `left`, `right` | required | A local path or any rclone remote. Which is which makes no difference to the engine. |
| `state` | required | Where this job remembers what the two sides agreed on. |
| `direction` | both ways | `leftToRight` or `rightToLeft` makes one side the source and never writes to it. Anything else, including an empty field, is both ways. |
| `mode` | `sync` | What a one-way job does beyond copying: `sync`, `mirror` or `move`. The last two need a one-way `direction`; see [Copy only, mirror or move](#copy-only-mirror-or-move). |
| `schedule` | none | A cron expression. Empty means the job only runs when somebody asks. |
| `watch` | `false` | Run when a local side changes. Needs a schedule as well; see below. |
| `watchSettle` | `2s` | How long the tree must go quiet before a change counts. |
| `runAtStart` | `false` | Run once as soon as the program starts, before waiting for the schedule. Fires once per start and never on a configuration reload. |
| `disabled` | `false` | Keeps the job in the file without running it on its own. It can still be started by hand. |
| `exclude` | none | Globs of paths to leave alone entirely; see [Exclude patterns](#exclude-patterns). |
| `excludeSets` | none | Names of [shared exclude lists](#shared-exclude-lists). Their patterns are added to `exclude`. |
| `noDefaultExcludes` | `false` | Also sync half-written files such as `*.part` and Office owner files. |
| `quietPeriod` | `5s` | How long a file must sit unchanged before it is touched. |
| `modWindow` | `2s` | How far modification times may differ and still count as equal. Only applies where a side cannot produce a hash. |
| `transfers` | `4` | How many files may be copied at once. |
| `emptyDirs` | `false` | Carry folders that hold no files. |
| `metadata` | `false` | Carry permissions, ownership and extended attributes where both sides can. |
| `keepVersions` | `0` | Keep the last N contents of a file that gets overwritten; see [Keeping old versions](#keeping-old-versions). |
| `foldCase` | ask the backends | `true` treats names that differ only in case as one file, `false` as two; see [Upper and lower case](#upper-and-lower-case). |
| `noTrash` | `false` | Delete outright instead of moving into the side's own trash. See the note below before switching it on. |
| `reportOnly` | `false` | Compare on every automatic turn and apply nothing. A run somebody starts by hand still applies. |
| `brakePercent` | `50` | Refuse a run deleting more than this share of known files. `0` switches the brake off. |
| `brakeFloor` | `10` | Never trip the brake below this many deletions. |
| `before` | none | A shell command run before every run. If it fails, the run does not start. See below. |
| `after` | none | A shell command run after every run, successful or not. If it fails, the run is marked failed. |

!!! warning "`noTrash` makes a deletion final"
    The trash is what makes the promise at the top of [Safety](safety.md) hold:
    nothing this program does destroys anything by itself. Switching it off
    withdraws that promise for this job, and it also applies to the losing side
    of a conflict, which is the case people forget. What you get back is the
    `.arrowloop` folder never being created, which matters on a share other
    people can see. Reasonable for a folder of downloads. A bad idea for
    documents.

    The field is spelled as the negative so that a configuration written before
    it existed, or one where somebody forgot the line, keeps its trash. In the
    interface the switch reads the other way round and says "keep a bin", since
    a switch labelled with a negative is one people set backwards.

!!! tip "Zero is not the same as leaving it out"
    `brakePercent` and `brakeFloor` distinguish an explicit `0` from an absent
    field on purpose. Switching off the mass-delete brake has to be something
    you typed, never something you got by forgetting a line.

!!! note "A one-way job restores, it does not skip"
    Both sides are still compared, because comparing is how the engine knows
    what changed. What the direction decides is what may be done with the
    answer. A file edited on the destination is restored from the source and a
    file deleted there is copied back, so the destination is made to agree.
    Skipping those changes instead would report them again on every run and the
    two sides would drift further apart for ever. What the source never had is
    left alone, since nothing there says it should exist, unless the job's
    `mode` is `mirror`.

## Copy only, mirror or move

`mode` says what a one-way job does beyond copying. The job form offers it as
**Mode**, with **Copy only**, **Mirror** and **Move**, and it can also be set
in the [defaults](#defaults-and-the-settings-tab).

`sync`, the default and **Copy only** in the interface, copies what the source
has and removes nothing. A file only the destination has stays there, and a
file deleted on the source keeps its copy on the destination while the record
lets go of it.

`mirror` makes the destination an exact copy of the source. A file the source
does not have is deleted there, whether the source deleted it or never had it,
and with `emptyDirs` a folder gone from the source goes too. Each deletion is an
ordinary one: it goes into that side's trash unless the job has `noTrash`, and
it counts towards the mass-delete brake, in case the two sides were set up the
wrong way round. A source that lists no files at all while the destination
holds some is refused, since mirroring it would empty the destination.

`move` copies a file across and then takes it off the source. Both happen as
one action, so the original only leaves once the copy has landed, and it goes
into the source side's trash like every other removal. A file both sides already
hold leaves the source as well, but only when the two checksums match. If both
sides changed a file, the source's version wins, and the destination's is kept
beside it under a conflict name rather than overwritten. A deletion on the
source is not carried over: the destination keeps its copy, as with `sync`.

`mirror` and `move` both decide which side is right, so a job that runs both
ways cannot use either and is refused when the file is read. So is any value
other than these three, because two of them delete, and a misspelt one must not
quietly run as a plain copy.

## Exclude patterns

Patterns work much like gitignore. Without a slash they match the file name
at any depth, so `*.tmp` catches `a/b/c.tmp`; with a slash they match the whole
path relative to the side's root. `**` crosses directory separators, `*` and `?`
do not, and naming a directory hides everything under it.

An exclude hides a path from the job entirely, on both sides and in the record,
which is why adding one never deletes anything; see
[Safety](safety.md#excluding-never-deletes). The names programs use while still
writing are excluded by default, and [Safety](safety.md#default-excludes) lists
them.

## Shared exclude lists

A list of patterns that several jobs need is written once, at the top of the
file under `excludeSets`, and asked for by name. The alternative is the same
twenty lines pasted into every job, drifting apart until two jobs that were
meant to ignore the same things quietly stop doing so.

```json
{
  "excludeSets": {
    "junk": ["Thumbs.db", ".DS_Store", "**/.thumbnails/**"]
  },
  "jobs": [
    {
      "name": "photos",
      "left": "/data/Photos",
      "right": "sftp:backup/photos",
      "state": "state/photos.db",
      "exclude": ["*.xmp"],
      "excludeSets": ["junk"]
    }
  ]
}
```

A list's patterns are added to the job's own `exclude` rather than replacing
it. A job asking for a list that does not exist is refused when the file is
read, because a filter that silently matches nothing breaks nothing anybody
would notice; it syncs the thing somebody asked it to leave alone. In the
interface the lists are kept under **Settings**, **Engine**, **Shared exclude
lists**.

## Keeping old versions

`"keepVersions": 5` keeps the last five contents of a file that a run
overwrites. Before the overwrite, the old file is moved into
`.arrowloop/versions/` on that side, which the scanner skips just as it skips
the trash, so a kept version never travels. If the old file cannot be kept, it
is not overwritten either: the file is postponed and the next run tries again.

Only overwrites are kept. A conflict already keeps both versions, and a rename
only ever lands on a free name. It is off by default, since most trees are never
edited in place and a copy of every overwrite would double them. `1` keeps only
the version about to be overwritten.

It is set in the file or in the [defaults](#defaults-and-the-settings-tab); the
interface has no control for it, and `arrowloop sync` has no flag for it.

## Upper and lower case

Whether a job matches names case-insensitively is read from its two backends:
if either cannot tell `Bild.jpg` from `bild.jpg`, the job folds case on both
ends. [How it decides](decisions.md#when-two-names-are-one-file) explains why it
has to be one answer for the whole job.

A backend can be wrong about itself. A Windows share mounted on Linux reports
itself case-sensitive and is not, and the pair then grows by one file per run.
`"foldCase": true` makes the job treat names that differ only in case as one
file, and `false` as two, whatever the backends say. Leaving it out asks the
backends. It can be set on a job or in the defaults, where the interface calls
it **Upper and lower case**, with **Ask the sides**, **Always one file** and
**Always two**.

## Watching

`"watch": true` starts a run when a local side changes, instead of waiting for
the next tick. The reason is not latency: a schedule has to list both sides in
full on every tick, which on a large tree or over a network is most of what a
run costs, and watching lets the engine sit still until there is a reason not
to.

It never replaces the schedule, and a watching job without one is refused. Only
a local side can be watched, most remote backends have no way to tell anyone
anything, and a watcher that missed an event has no way to know it did. The
schedule is what eventually notices what the watcher did not.

In the interface, real time is one of the schedules rather than a switch beside
them. Picking **Real time** in the schedule strip sets `"watch": true` and writes
a backstop as well: an hourly schedule, shown beside it and open to change.

Events are collected over a settle window, `watchSettle`, because copying a
folder in produces one event per file and the interesting fact is that something
changed. On Linux and macOS a new folder is watched as it appears, since the
kernel reports on a directory's own entries rather than its whole subtree; on
Windows one watch covers each side's whole tree. The tool's own trash and every
excluded path are ignored, and a job's watcher is muted around its own runs, or
the engine would spend its life answering its own writes.

## Running at start

`"runAtStart": true` runs the job once as soon as the program starts, before its
schedule is next due.

It exists because of what a schedule cannot say. A machine that was off
overnight missed every turn a daily job had, and the job's next run is tomorrow:
the two sides stay apart for a whole day for no reason other than the clock.
This is also the setting that makes autostart worth switching on, since a
program that starts with the session and then sits there until 03:00 has not
helped anybody who has just turned their computer on.

Three things it does not do. It fires **once per program start**
and never on a configuration reload, so saving one job in the interface does not
set every job in the file running. A `disabled` job does not run, because
disabled has to mean disabled everywhere. And the runs go one after another in
file order rather than all at once, for the same reason ordinary runs are
serialised: they share one uplink and one disk, and a start-up burst is where
that matters most.

## A job never overlaps itself

A job set to run every fifteen minutes that takes twenty lets the next turn go
by, with a line in the log saying so. Queueing instead would let a job that is
merely too slow build an unbounded backlog of itself. Jobs run one at a time by
default (`parallelJobs`), because two of them share one uplink and one disk.

## After a failure

```json
"retry": { "attempts": 3, "wait": "5m" }
```

A scheduled job that fails stays due until it succeeds, and `retry` limits how
hard it tries. It gets `attempts` further tries, three by default. The first
waits for `wait`, five minutes by default, and each one after that waits twice
as long as the one before, up to six hours. With the defaults the tries wait
five, ten and twenty minutes, so a nightly job still has the night to finish in.
After the last one the job runs once at each scheduled time, and a success
starts the count again. `0` attempts means no further tries, and a wait that
cannot be read counts as five minutes.

It is one setting for the whole file rather than per job, because how patient
to be after a failure depends on the machine, not on a folder pair. In the
interface it sits under **Settings**, **Engine**, **After a failure**, with the
wait in minutes.

On a computer or in a container the scheduler looks once a minute for a failed
job whose wait is over. On Android the same rule decides what runs when the app
wakes the engine, and without the limit a failed job would run at every
wake-up, spending a night's battery on a remote that is still down.

## Commands before and after a run

```json
{
  "name": "database",
  "left": "/srv/dump",
  "right": "b2:backup/dump",
  "state": "state/database.db",
  "before": "pg_dump -U app app > /srv/dump/app.sql",
  "after": "/usr/local/bin/report-backup.sh"
}
```

`before` runs before the two sides are compared. It is the place to write a
database dump, stop a service that holds files open, or mount a drive. If it
exits with anything other than zero, the run does not start, and the run record
carries the last lines the command printed, since that is usually where a
script says why it gave up.

`after` runs once the run is over, whether it went well or not, so it can
restart what `before` stopped. It learns how the run went from its environment:

| Variable | What it holds |
|---|---|
| `ARROWLOOP_JOB` | The job's name. Also set for `before`. |
| `ARROWLOOP_LEFT`, `ARROWLOOP_RIGHT` | The two sides as written in the file. Also set for `before`. |
| `ARROWLOOP_RESULT` | `ok` or `failed`. |
| `ARROWLOOP_ERROR` | Why the run failed, empty otherwise. |
| `ARROWLOOP_COPIED`, `ARROWLOOP_MOVED`, `ARROWLOOP_DELETED` | How many files the run copied, moved and deleted. |
| `ARROWLOOP_CONFLICTS`, `ARROWLOOP_SKIPPED` | How many files were in conflict and how many were left for later. |

A command that exits with an error after a successful run marks the run failed,
so a notification goes out for it. The commands run through `sh -c`, or
`cmd /C` on Windows, in the program's working directory. Each may take fifteen
minutes; after that it is stopped, because a hanging command would hold its
job's place and every job queued behind it. A command that is stopped, at that
limit or because the run was stopped, takes every program it started with it.
A program that a command which finished cleanly left running in the background,
such as an SSH tunnel, keeps running.

!!! warning "Only the file can set them"
    Anybody who can reach the interface could otherwise run anything on this
    machine, with the rights of the process. So the interface shows the
    commands but cannot set or change them: every save from the interface puts
    back what the file on disk says for a job of the same name. A job created or
    renamed in the interface starts without commands. The jobs tab and the file
    agree on everything else.

## Every run is written down

The run log keeps successes as well as failures. A crash is loud; the failure
worth guarding against is a job that has been failing quietly since Tuesday
because a path changed. That is also why `arrowloop jobs` shows when each job
last succeeded rather than when it last ran; see
[the command line](cli.md#jobs).

A machine nobody looks at keeps writing records, and a watching job writes one
per change, so the program trims the log once a day while it runs. A record is
kept for ninety days unless `historyKeep` says otherwise, as a duration in hours
such as `"720h"` for thirty days, since there is no unit for days. `"0"` keeps
every record. A value that cannot be read counts as ninety days, so a typo never
switches trimming off. `arrowloop daemon` also trims once as it starts, by the
same value unless its `-keep-history` flag gives another.

## Whole file

| Field | Default | What it does |
|---|---|---|
| `bwlimit` | none | rclone syntax, `1M` or a timetable like `08:00,512k 19:00,off`. |
| `parallelJobs` | `1` | How many jobs may run at once. |
| `history` | beside the file | Where run records go. A change takes effect the next time the program starts. |
| `historyKeep` | ninety days | How long a run record is kept, such as `"720h"`. `"0"` keeps every record; see [Every run is written down](#every-run-is-written-down). |
| `notify.matrix` | none | A room to post into: homeserver, room id, access token. |
| `notify.webhook` | none | A URL that receives a small JSON document. |
| `notify.onSuccess` | `false` | Report every run rather than only the failures. |
| `retry.attempts` | `3` | How many further tries a failed scheduled run gets before the job waits for its next scheduled time. `0` means none; see [After a failure](#after-a-failure). |
| `retry.wait` | `5m` | How long to wait before the first further try. Each try after that waits twice as long, up to six hours. |
| `defaults` | none | Values for every job that does not set its own; see [below](#defaults-and-the-settings-tab). |
| `excludeSets` | none | Named lists of exclude patterns; see [Shared exclude lists](#shared-exclude-lists). |

!!! note "The bandwidth limit is not per job"
    rclone's token bucket is process-wide, so a per-job limit would be a promise
    the mechanism underneath cannot keep. Two jobs on one machine share one
    uplink either way.

    The limit is checked when the file is read, like everything else, and a
    limit saved under **Settings**, **Engine** applies to the running process at
    once. Everything else is per job, and each job gets its own copy of rclone's
    settings, so a job asking for eight transfers does not change what another
    job is doing.

Notifications default to failures only, because a tool that announces every
successful sync teaches you to ignore it, and then the one message that mattered
is ignored with the rest. Matrix and a plain webhook are supported, and a
failure at one destination does not stop the other from firing.

## Defaults and the Settings tab

The settings at the top of the file have a place in the interface as well as in
the file. The bandwidth limit, how many jobs may run at once, where the run log
lives, who gets told and what happens after a failure sit under **Settings**,
**Engine**, and so do the defaults below, the two brakes among them.
`historyKeep` has no control there and is set in the file.

What is usually the same for every job lives in `defaults`, and a job keeps only
what makes it different, so the job form stays short:

```json
"defaults": {
  "quietPeriod": "5s",
  "transfers": 4,
  "brakePercent": 50,
  "brakeFloor": 10
}
```

`defaults` takes `direction`, `mode`, `schedule`, `quietPeriod`, `modWindow`,
`transfers`, `emptyDirs`, `metadata`, `brakePercent`, `brakeFloor`,
`keepVersions` and `foldCase`, with the meaning they have on a job. They are
filled in when the file is read and before it is checked, so a value from the
defaults goes through the same rules as one written on the job.

An empty text or a zero number on a job counts as unset and takes the default.
The switches and the brakes, which can be written as `false` or `0`, keep what
the job states, so a job can switch off what the defaults switch on.
`keepVersions` cannot be switched off that way: zero means both off and unset,
so a job cannot turn versioning off against a default that turns it on. `watch`
and `noTrash` have no default, since a default that switched either on could not
be switched off for a single job.

Changing a default changes every job that never disagreed with it, and none of
the jobs that did.

## Backup and restore

**Settings**, **General**, **Back up your settings** exports every job and every
setting to a single JSON file and imports one back the same way, so a new
machine is one restore away.

Importing replaces everything and asks first, with the file's name in the
question, because the one thing nobody can do afterwards is get the old setup
back. The imported file is checked like every other write, so a file the
program would refuse leaves the old setup in place. Like every save from the
interface, it keeps the `before` and `after` commands the file on disk has for a
job of the same name and gives every other job none. The password, the second
factor and the passkeys live in `security.json` and are not part of the backup.

## Services that sign in through a browser

Every backend rclone ships is compiled in. The services that only sign in
through a browser, such as OneDrive, Google Drive and Dropbox, take a token made
once with `rclone authorize`, because the engine often runs on a machine that
has no browser to open.

Run `rclone authorize "<backend>"` on a computer that has a browser. It opens
the provider's sign-in page and prints a token when you are done; paste that
whole line into the token field when you add the service under **Targets**. The
client id and secret below it are optional and only matter if you registered
your own application with the provider.
