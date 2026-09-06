# Configuring a job

Jobs live in `arrowloop.json`. The Edit tab in the interface writes the same
file, through the same validator, so neither way can produce something the other
refuses.

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
durations and **misspelled field names**. JSON normally ignores a field it does
not recognise, so `"excludes"` instead of `"exclude"` would leave the filter
empty and sync exactly the files you thought you had excluded.

Paths resolve against the file itself, not against whatever directory a service
manager happened to start the process in.

## Per job

| Field | Default | What it does |
|---|---|---|
| `name` | required | How the job is asked for and how its history is kept apart. Two jobs cannot share one. |
| `left`, `right` | required | A local path or any rclone remote. Which is which makes no difference to the engine. |
| `state` | required | Where this job remembers what the two sides agreed on. |
| `direction` | both ways | `leftToRight` or `rightToLeft` makes one side the source and never writes to it. Anything else, including an empty field, is both ways. |
| `schedule` | none | A cron expression. Empty means the job only runs when somebody asks. |
| `watch` | `false` | Run when a local side changes. Needs a schedule as well; see below. |
| `watchSettle` | `2s` | How long the tree must go quiet before a change counts. |
| `disabled` | `false` | Keeps the job in the file without running it. |
| `exclude` | none | Globs. Without a slash they match the file name at any depth; with one, the whole path. `**` crosses directories. |
| `noDefaultExcludes` | `false` | Also sync half-written files such as `*.part` and Office owner files. |
| `quietPeriod` | `5s` | How long a file must sit unchanged before it is touched. |
| `modWindow` | `2s` | How far modification times may differ and still count as equal. Only applies where a side cannot produce a hash. |
| `transfers` | `4` | How many files may be copied at once. |
| `emptyDirs` | `false` | Carry folders that hold no files. |
| `metadata` | `false` | Carry permissions, ownership and extended attributes. |
| `brakePercent` | `50` | Refuse a run deleting more than this share of known files. `0` switches the brake off. |
| `brakeFloor` | `10` | Never trip the brake below this many deletions. |

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
    left alone: nothing there says it should exist.

## Watching

`"watch": true` starts a run when a local side changes, instead of waiting for
the next tick. The reason is not latency: a schedule has to list both sides in
full on every tick, which on a large tree or over a network is most of what a
run costs.

It never replaces the schedule, and a watching job without one is refused. Only
a local side can be watched, most remote backends have no way to tell anyone
anything, and a watcher that missed an event has no way to know it did. The
schedule is what eventually notices what the watcher did not.

## Whole file

| Field | Default | What it does |
|---|---|---|
| `bwlimit` | none | rclone syntax, `1M` or a timetable like `08:00,512k 19:00,off`. |
| `parallelJobs` | `1` | How many jobs may run at once. |
| `history` | beside the file | Where run records go. |
| `notify.matrix` | none | A room to post into: homeserver, room id, access token. |
| `notify.webhook` | none | A URL that receives a small JSON document. |
| `notify.onSuccess` | `false` | Report every run rather than only the failures. |

!!! note "The bandwidth limit is not per job"
    rclone's token bucket is process-wide, so a per-job limit would be a promise
    the mechanism underneath cannot keep. Two jobs on one machine share one
    uplink either way.

Notifications default to failures only, because a tool that announces every
successful sync teaches you to ignore it, and then the one message that mattered
is ignored with the rest.
