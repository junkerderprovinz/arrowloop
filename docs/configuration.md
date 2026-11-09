# Configuring a job

A shell history is not a place to keep jobs. Somebody with a photo folder, a
documents folder and a server backup has three of them, each with its own
schedule, its own filters and its own idea of what may be deleted, so everything
past `arrowloop sync` works from a configuration file.

Jobs live in `arrowloop.json`. The Jobs page in the interface writes the same
file, through the same validator, so neither way can produce something the other
refuses. A complete example is
[arrowloop.example.json](https://github.com/junkerderprovinz/arrowloop/blob/main/arrowloop.example.json).

```json
{
  "bwlimit": "",
  "parallelJobs": 1,
  "notify": {
    "channels": [
      { "id": "room", "kind": "matrix", "enabled": true,
        "matrix": { "homeserver": "https://matrix.example.org", "room": "!abc:example.org", "token": "syt_..." } }
    ]
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
| `left`, `right` | required | A local path or any rclone remote. Which is which makes no difference to the engine. Both naming one place is refused, also through a symlink, an alias or two remotes set up for the same server, bucket or drive. |
| `state` | required | Where this job remembers what the two sides agreed on. |
| `direction` | both ways | `leftToRight` or `rightToLeft` makes one side the source and never writes to it. Anything else, including an empty field, is both ways. |
| `mode` | `sync` | What a one-way job does beyond copying: `sync`, `mirror` or `move`. The last two need a one-way `direction`; see [Copy only, mirror or move](#copy-only-mirror-or-move). |
| `schedule` | none | A cron expression. Left out, the job takes the default schedule; written as `""`, it only runs when somebody asks, whatever the default says. |
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
| `newerWins` | `false` | Settle a conflict for the version changed last and move the other into the trash, instead of keeping both. Two versions whose times lie within `modWindow` of each other still keep both. Only a job that writes both ways has conflicts. |
| `reportOnly` | `false` | Compare on every automatic turn and apply nothing. A run somebody starts by hand still applies. |
| `brakePercent` | `50` | Hold a run deleting more than this share of known files. `0` switches the brake off. |
| `changePercent` | `50` | Hold a run overwriting more than this share of known files. `0` switches the brake off. |
| `brakeFloor` | `10` | Never trip either brake below this many deletions or overwrites. |
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
    `brakePercent`, `changePercent` and `brakeFloor` distinguish an explicit `0`
    from an absent field on purpose. Switching off a brake has to be something
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
in the [defaults](#defaults-and-the-settings-tiles).

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
interface the lists are kept on the **Sync** tile under **Settings**.

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

It is set in the file or in the [defaults](#defaults-and-the-settings-tiles); the
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

A side whose folder is not there, because its drive is unplugged or the folder
has not been made yet, is left out and the other side is watched meanwhile. The
engine looks again every minute and starts watching the folder once it turns
up, and the same happens to a folder that goes away while watched. The log says
once that a folder is missing and once that it is watched. A watcher that will
not start for any other reason is tried again after a minute, then after twice
as long each time, up to an hour.

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
interface it sits on the **Sync** tile under **Settings**, in **Retries**,
with the wait in minutes.

On a computer or in a container the scheduler looks once a minute for a failed
job whose wait is over. On Android the same rule decides what runs when the app
wakes the engine, and without the limit a failed job would run at every
wake-up, spending a night's battery on a remote that is still down.

## Anomalies

```json
"anomalies": { "off": false, "failingAfter": 3, "overdueDays": 2, "unusual": true, "notifyNotes": false }
```

A run a brake refuses holds its job until somebody answers it; see
[A refused run holds the job](safety.md#a-refused-run-holds-the-job). The brakes
themselves are set per job, with `brakePercent`, `changePercent` and
`brakeFloor`, because what is implausible depends on the folder: a download
folder is emptied on purpose, a photo archive is not. In the interface a job's
own brakes are set on the job's page, in its **Brakes** card, with
**Override**.

`anomalies` sets the notes that hold nothing. `failingAfter` is how many
failed runs in a row make one, and `overdueDays` how many days late a scheduled
run may be. The days count from the scheduled run that was missed, not from the
last run, so a job that runs once a week is overdue only when its weekly run is
that many days late. `0` switches either off. `unusual` says whether a run far
outside what its job usually does makes a note, which it does unless set to
`false`; see [Unusual runs](safety.md#unusual-runs). `"off": true` switches
all three off together with the Anomalies page. The brakes keep holding then, since they
are set on their own; a held job is answered from its own status. `notifyHeld` and `notifyNotes`
say whether a held job and a note are sent where runs report to; a held job is
by default and a note is not. The desktop app also shows them as a notification
of the system. On Windows and macOS it plays ArrowLoop's own sound, which keeps
quiet while Windows does not disturb; on Linux it asks for the warning sound of
the desktop's sound theme.

The findings are kept in `anomalies.json` beside the configuration, a closed
one for thirty days. In the interface they have a page of their own.

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
    renamed in the interface starts without commands. The interface and the file
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
| `notify.channels` | none | Where messages go, one entry per channel: Discord, Slack, ntfy, Gotify, Matrix, mail, Apprise, a webhook of your own or Healthchecks.io; see [Notifications](#notifications). |
| `retry.attempts` | `3` | How many further tries a failed scheduled run gets before the job waits for its next scheduled time. `0` means none; see [After a failure](#after-a-failure). |
| `retry.wait` | `5m` | How long to wait before the first further try. Each try after that waits twice as long, up to six hours. |
| `anomalies.failingAfter` | `3` | How many failed runs in a row make a note. `0` means never; see [Anomalies](#anomalies). |
| `anomalies.off` | `false` | Switch the notes and the Anomalies page off. The brakes keep holding. |
| `anomalies.unusual` | `true` | Note a run far outside what its job usually does; see [Unusual runs](safety.md#unusual-runs). |
| `anomalies.overdueDays` | `2` | How many days late a scheduled run may be, counted from the run that was missed, before it makes a note. `0` means never. |
| `anomalies.notifyHeld` | `true` | Report a job a brake holds where runs report to. |
| `anomalies.notifyNotes` | `false` | Report the notes there as well. |
| `defaults` | none | Values for every job that does not set its own; see [below](#defaults-and-the-settings-tiles). |
| `excludeSets` | none | Named lists of exclude patterns; see [Shared exclude lists](#shared-exclude-lists). |
| `keepJobOrder` | `false` | List the jobs in the order they stand in `jobs` rather than by name. The interface sets it the first time a job is moved, and a new job goes to the end. |
| `autoBackup.off` | `false` | Switch the automatic backups off; see [Automatic backups](#automatic-backups). |
| `autoBackup.everyDays` | `1` | How many days pass between two automatic backups, up to 365. |
| `autoBackup.at` | `03:00` | The time of day an automatic backup is due, as `HH:MM` on the engine's clock. |
| `autoBackup.keep` | `7` | How many automatic backups stay in the folder, up to 1000. |
| `autoBackup.folder` | `backups` beside the file | Where the automatic backups go. A relative path is relative to the file. |

!!! note "The bandwidth limit is not per job"
    rclone's token bucket is process-wide, so a per-job limit would be a promise
    the mechanism underneath cannot keep. Two jobs on one machine share one
    uplink either way.

    The limit is checked when the file is read, like everything else, and a
    limit saved on the **General** tile applies to the running process at
    once. Everything else is per job, and each job gets its own copy of rclone's
    settings, so a job asking for eight transfers does not change what another
    job is doing.

## Notifications

```json
"notify": {
  "channels": [
    { "id": "phone", "kind": "ntfy", "name": "Phone", "enabled": true, "on": "failure",
      "ntfy": { "url": "https://ntfy.sh/my-arrowloop-topic" } },
    { "id": "room", "kind": "matrix", "enabled": true, "on": "failure",
      "matrix": { "homeserver": "https://matrix.example.org", "room": "!abc:example.org", "token": "syt_..." } },
    { "id": "mail", "kind": "smtp", "enabled": true, "on": "always",
      "smtp": { "host": "mail.example.org", "port": 587, "tls": "starttls", "username": "arrowloop", "password": "...",
                "from": "arrowloop@example.org", "to": "me@example.org, backup@example.org" } },
    { "id": "checks", "kind": "healthchecks", "enabled": true,
      "healthchecks": { "url": "https://hc-ping.com/<uuid>", "byKey": { "photos": "https://hc-ping.com/<another uuid>" } } }
  ]
}
```

`channels` is a list, so there can be as many as you like, two Discord
channels or a mail for every run beside an ntfy push for the failures. Each
entry has an `id` of its own, a `kind`, an optional `name` the card and the log
show, an `enabled` switch that turns it off and keeps what it holds, and the
block of its service under the same name as `kind`.

`on` says what a channel gets: `never`, `failure` or `always`. The default is
`failure`, because a tool that announces every successful sync teaches you to
ignore it, and then the one message that mattered is ignored with the rest. A
failed run counts as a failure. A job a brake holds counts as one too and is
reported unless `anomalies.notifyHeld` is `false`. The notes about a job that
keeps failing, a job that is overdue and an unusual run go out as a warning,
which a channel set to `failure` carries, when `anomalies.notifyNotes` is
`true`.

| `kind` | Block | What it sends |
|---|---|---|
| `discord` | `discord.url` | An embed in the channel the webhook address belongs to, coloured by how good or bad the news is. |
| `slack` | `slack.url` | A `text` to an incoming webhook. |
| `ntfy` | `ntfy.url`, `ntfy.token` | The message to the topic's address with a title, `high` priority for a failure and `urgent` for a brake against bulk overwrites. The token is only needed for a topic that asks for one. |
| `gotify` | `gotify.url`, `gotify.token`, `gotify.priorityFailure`, `gotify.prioritySuccess` | A message to the server, priority 8 for bad news and 5 otherwise unless set. The token can also sit in the address as `?token=`. |
| `matrix` | `matrix.homeserver`, `matrix.room`, `matrix.token` | A message in the room, posted as the account the token belongs to. The account has to be in the room, and the room can be given as an `#alias`. |
| `smtp` | `smtp.host`, `smtp.port`, `smtp.tls`, `smtp.username`, `smtp.password`, `smtp.from`, `smtp.to` | A plain-text mail. `tls` is `starttls` (the default, port 587), `tls` for a connection encrypted from the start (port 465) or `none`. Under `starttls` a server that does not offer STARTTLS is refused rather than sent the password in clear. `to` takes several addresses separated by commas or semicolons, and ArrowLoop logs in only when `username` is set. |
| `apprise` | `apprise.url`, `apprise.tags`, `apprise.urls` | A POST to an [Apprise API](https://github.com/caronc/apprise-api) server you run. With a key in `url`, it goes to whatever that key is set up for, and `tags` limits a shared key to some of its targets. With `urls`, such as `tgram://...` or `pover://...`, `url` is the server's `/notify` without a key, and Telegram, Pushover and the other services Apprise knows work without a key on the server. |
| `webhook` | `webhook.url`, `webhook.method`, `webhook.headers`, `webhook.body` | A request of your own: `POST` (the default), `PUT` or `GET`, with the headers and the body as written. `%%title%%`, `%%body%%`, `%%ok%%`, `%%event%%`, `%%severity%%`, `%%time%%` and `%%link%%` are filled in, escaped for where they stand. A new webhook on the card starts with `{"subject":"%%title%%","body":"%%body%%","ok":%%ok%%}`. |
| `healthchecks` | `healthchecks.url`, `healthchecks.byKey` | A ping to `<url>/start` when a run begins, then `<url>` when it succeeds or `<url>/fail` when it does not, with the run's summary as the body. `byKey` gives a job its own check, by job name; every other job pings `url`. `on` counts only as `never`, which keeps the check quiet. Any server that speaks the same protocol works. |

A job held by a brake has not synced, so its check gets `/fail`, and so does a
run whose drive went missing after the start was pinged. A drive that is
missing before anything starts is no run, and the check hears nothing; it goes
late on its own schedule if that keeps happening. A check under `byKey` follows
the name, so a renamed job pings the shared check until its entry is renamed
too.

Every attempt is limited to fifteen seconds (`timeoutSeconds`, up to 60), and a
message a second try could still deliver, after a refused connection, a
timeout, a 429 or a 5xx, is tried three times (`attempts`, up to 5) with a
pause in between. The channels are sent to at the same time, and a failure at
one does not stop the others. A message that cannot be delivered is written to
the log and changes nothing about the run. The log names the channel and says
what went wrong, but never the address or a token. A password written into an
address in a run's error, such as `sftp://user:secret@host`, is replaced by
`***` before the message leaves. A channel switched on but missing something,
such as an address, sends nothing, and the log says so when the settings are
loaded.

Every token and password, every header value and every address that is its own
key (a webhook, Discord, Slack, ntfy, Gotify, an Apprise key or its `urls`,
every Healthchecks check) stay on the server. The Notifications card on
**Safety net** shows them as **Saved** with **Change**; the settings API and the
bug report hand out `********` in their place, and saving the page back keeps
what is stored. A token or password is put back only beside the server it was
saved for, so whoever changes the address has to type it again. Every channel
on the card has **Send a test**, which sends through that channel as the card
shows it, saved or not, ignoring `on` and the channel's switch, and says why
when it fails. The phone reports runs through Android's own notifications and
sends through none of these channels.

A file from before the channel list holds one block per service under `notify`
(`webhook` with `webhookFormat`, `matrix`, `smtp`, `apprise`, `healthchecks`
with `jobs`, and `on` or `onSuccess`). ArrowLoop reads it into channels when it
starts, keeps everything that was set up, and writes `channels` into the file.
The older keys stay beside it, so going back to an older version loses nothing;
a later version removes them. A backup in the older shape is restored the same
way.

!!! note "No Unraid notifications"
    Unraid's own notifications come from its notify script, a PHP script that
    reads the host's configuration and runs the host's mail and agent setup. A
    container cannot run it. Writing notification files into the host's
    `/tmp/notifications` through a mount would skip the agents and the mail
    Unraid is set up for, and the Unraid API needs an API key, which is a
    credential for the host. Apprise or ntfy reach the same phone without
    either.

## Status for dashboards

A dashboard such as Homepage or Homarr reads how ArrowLoop is doing from
`/api/fortress/v1/status` and what its runs did from `/api/fortress/v1/log`,
the same two addresses every app of the family answers on. Both need a read
token, made under **Settings**, **Security**, **Read tokens** and sent as
`Authorization: Bearer <token>`. A read token opens these two addresses and
nothing else, whether a password is set or not. It is shown once when it is
made; ArrowLoop keeps only a fingerprint of it in `security.json`.

The status names the jobs that need you (a job a brake holds, the notes, a last
run that failed or left files for later), the runs in progress with how far
they got, and when each scheduled job runs next. A run of a mirror or a move
job says that a restart should wait for it. The log has one entry per stored
run, oldest first, and pages with `?after=<cursor>&limit=<n>`. Both answer in
the language `lang` or the `Accept-Language` header asks for.

## Defaults and the settings tiles

The settings at the top of the file have a place in the interface as well as in
the file, each on a tile under **Settings**. The bandwidth limit, how many jobs
may run at once and where the run log lives are on **General**; the defaults
below, what happens after a failure and the shared exclude lists are on
**Sync**; the two brakes, the anomaly notes and who gets told are on **Safety
net**. `historyKeep` has no control there and is set in the file.

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
`transfers`, `emptyDirs`, `metadata`, `brakePercent`, `changePercent`, `brakeFloor`,
`keepVersions` and `foldCase`, with the meaning they have on a job. They are
filled in when the file is read and before it is checked, so a value from the
defaults goes through the same rules as one written on the job.

An empty text or a zero number on a job counts as unset and takes the default,
apart from `schedule`, where `""` means the job runs only when asked. The
switches and the brakes, which can be written as `false` or `0`, keep what the
job states, so a job can switch off what the defaults switch on.
`keepVersions` cannot be switched off that way: zero means both off and unset,
so a job cannot turn versioning off against a default that turns it on. `watch`
and `noTrash` have no default, since a default that switched either on could not
be switched off for a single job.

Changing a default changes every job that never disagreed with it, and none of
the jobs that did. In the interface a job shows each of these values locked
until **Override** gives it one of its own, and **Exceptions** on the **Sync**
and **Safety net** tiles lists the jobs that have one.

## Backup and restore

**Settings backup**, on the **General** tile under **Settings**, has two
rows. **Back up all jobs and all settings** exports them to a single JSON file,
and **Restore all jobs and all settings** imports one back, so a new machine is
one restore away. The phone's card uses the same two rows. It writes to
Downloads unless another folder is typed or chosen with **Choose a folder**, and
**Choose a file to import** opens Android's own file picker, which also reaches
the files in a cloud app.

Importing replaces everything and asks first, with the file's name in the
question, because the one thing nobody can do afterwards is get the old setup
back. The imported file is checked like every other write, so a file the
program would refuse leaves the old setup in place. Like every save from the
interface, it keeps the `before` and `after` commands the file on disk has for a
job of the same name and gives every other job none. The password, the second
factor and the passkeys live in `security.json` and are not part of the backup.

### Automatic backups

**Automatic backups**, the card below, keeps copies of `arrowloop.json` without
anybody having to think of it. It is on from the start: every night at 03:00
the engine looks at the file and, if it changed since the newest copy, writes a
new one into the `backups` folder beside it, named after the moment it was
made, such as `arrowloop-auto-20261107-031500.json`. A file that has not
changed is not copied again, so the copies reach back as far as the edits do.
Right before an import replaces everything, or one from FolderSync or
luckyBackup adds to it, the engine keeps the setup as it was the same way,
whatever the day's copy did. If that copy fails, the import still goes ahead
and the card shows the failure.

**Days between backups**, **Time of day**, **Backups to keep** and **Backup
folder** set how often, when, how many and where. **Choose a folder** beside the
folder opens the folder picker on the machine the engine runs on. The days are counted on the
calendar and the time is read off the clock of the machine the engine runs on,
the same way the jobs' schedules read it, so a backup stays at its time when
the clocks change for summer. A computer or phone that is off or asleep at that
time makes the backup as soon as it is back, once, and the next one comes at
the usual time again. Once there are more copies than you keep, the oldest
goes. Only files named like the engine's own copies are ever removed, so an
export you save in the same folder stays. A folder the engine cannot write to is
refused when you enter it, and a backup that fails later is shown on the card
and tried again an hour after.

Each copy is the file byte for byte, the same thing **Back up all jobs and all
settings** downloads, so it carries the notification secrets as the export does
and is written readable by the account running ArrowLoop alone. The password and
the targets' own settings in `rclone.conf` are not part of it. **Latest backup**
shows when the newest one was made. To put a copy back, choose it with **Import
settings**, which asks first like any import. The phone app has the same card under **Settings**.
On the phone the copies stay inside the app unless you choose a folder in
Download or Documents, which needs access to all files.

### Moving over from FolderSync or luckyBackup

The same **Import settings** button takes two files from other programs and
tells them apart by what is in them:

- **FolderSync**: the JSON file that **Export configuration** under
  Settings › Advanced writes into FolderSync's backup folder. FolderSync's
  documentation lists it for the Business edition. Its **Backup database** file
  is a database rather than a configuration and cannot be read.
- **luckyBackup**: a `.profile` file from `~/.luckyBackup/profiles/`. A profile
  from before luckyBackup 0.4.2 is binary; open it in a newer luckyBackup and
  save it once.

Nothing is replaced. Before anything is saved, a window lists the jobs and
targets that would be added, what still has to be filled in, and every setting
that stays behind because ArrowLoop has nothing like it, quoted as the file
spells it so it can be found there. A name that is already taken gets a number.

| From | Becomes |
|---|---|
| FolderSync folder pair, luckyBackup task | a job; one-way or two-way as before |
| FolderSync account | a target: SFTP, FTP, SMB, WebDAV (Nextcloud, ownCloud), S3, Dropbox, Google Drive, OneDrive, pCloud, Box, Yandex, HiDrive, Koofr, MEGA, Proton Drive, Google Cloud Storage; the phone's own storage stays a folder |
| luckyBackup SSH destination or source | an SFTP target with the host, user, port and key file |
| FolderSync sync interval, or a schedule in standard cron | the job's schedule |
| FolderSync instant sync, folder monitoring | watching, with an hourly schedule behind it |
| FolderSync "delete after sync", move mode | mode `move` |
| FolderSync deletions on a one-way pair, luckyBackup "delete files on the destination" | mode `mirror` |
| FolderSync "overwrite oldest" on a conflict | `newerWins` |
| FolderSync name and folder filters, luckyBackup excludes and its exclude check boxes | `exclude` patterns |
| luckyBackup snapshots | `keepVersions`, one fewer than the snapshots |

No password, key passphrase, secret key or token is carried over, even where
the file holds one. Each target that needs one is named in the window, and is
filled in or signed in again on **Targets**. Every imported job arrives paused,
since its folders come from another machine; look over each one and resume it.
luckyBackup keeps its schedule in cron, outside the profile, so its jobs follow
the default schedule.

What stays behind includes FolderSync's webhooks, notifications, network and
charging conditions, time-stamped backup folders, include filters and filters
by size, age or regular expression, and luckyBackup's commands before and after
a task, include lists, extra rsync options and rsync daemon modules. The
commands stay behind because ArrowLoop runs a command only when it is written
into `arrowloop.json` by hand.

## Services that sign in through a browser

Every backend rclone ships is compiled in. The services that only sign in
through a browser, such as OneDrive, Google Drive and Dropbox, take a token made
once with `rclone authorize`, because the engine often runs on a machine that
has no browser to open.

Run `rclone authorize "<backend>"` on a computer that has a browser. It opens
the provider's sign-in page and prints a token when you are done; paste that
whole line into the token field when you add the service with **Connect
storage and clouds** on **Targets**. The
client id and secret below it are optional and only matter if you registered
your own application with the provider.
