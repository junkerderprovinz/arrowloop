<h1 align="center">ReeveRoll</h1>

<p align="center">A two-way file sync engine with a state database, a trash and a brake, plus the scheduler that keeps it running. Working title.</p>

## Table of Contents

1. [What this is](#1-what-this-is)
2. [How it decides](#2-how-it-decides)
3. [When two names are one file](#3-when-two-names-are-one-file)
4. [Safety](#4-safety)
5. [Filters and half-written files](#5-filters-and-half-written-files)
6. [Running it once](#6-running-it-once)
7. [Running it unattended](#7-running-it-unattended)
8. [Tests](#8-tests)
9. [What it will not carry, and what it says about it](#9-what-it-will-not-carry-and-what-it-says-about-it)
10. [Why not just use something that exists](#10-why-not-just-use-something-that-exists)

<br>

## 1. What this is

A self-hosted GoodSync replacement. The engine came first, cut down to the part that can lose data so that part could be proved before anything was built on top of it; the scheduler, the job file and the run log sit on top of it now.

A reeve was the manorial officer who moved goods between two holdings, kept his own notched record of what he had moved, and answered for it at the annual view of account. He also had standing to refuse a reckoning that did not add up. The roll is the parchment he was judged against. Those are the three pieces below: the two ends, the state database, and the refusal.

Targets come from [rclone](https://rclone.org), embedded as a library rather than shelled out to, so local folders, SMB shares, SFTP hosts and S3 buckets are all the same thing to the engine. Only `local`, `sftp` and `s3` are compiled in at this stage: importing every backend rclone supports would multiply the binary size for targets nobody has asked for.

<br>

## 2. How it decides

Everything hangs on a three-way comparison: the left side now, the right side now, and what the two agreed on last time. Without that third term, "the file is here but not there" is ambiguous, and the two readings call for opposite actions.

| left \ right | untouched | changed | deleted | new |
|---|---|---|---|---|
| **untouched** | nothing | copy right to left | delete on left | - |
| **changed** | copy left to right | conflict, keep both | restore, the edit wins | - |
| **deleted** | delete on right | restore, the edit wins | drop the record | - |
| **new** | - | - | - | identical: record it. different: conflict |

Two of those cells are judgement calls rather than logic:

**An edit beats a deletion.** When one side deleted a file and the other edited it, the file comes back. A deletion can be repeated by hand in a second; an edit that was thrown away cannot be recovered from anywhere.

**A conflict keeps both versions and still converges.** The newer file keeps the plain name on both sides, the older is preserved next to it as `name.conflict-<side>-<timestamp>.ext`, on both sides. Refusing to resolve at all would look safer and would in fact leave the job permanently stuck, reporting the same conflict on every run forever.

A delete on one side plus a create on the same side with identical content is folded into a single move, so renaming a folder of photos does not re-upload them. Rename detection needs a real hash on both the record and the new file; a backend that cannot produce one gets a copy and a delete instead, which is slower and still correct.

<br>

## 3. When two names are one file

A file is matched by a **key**, not by its name. The name stays with the side it came from and is what gets handed to the backend; the key exists only to line the two sides up against each other and against the record. Two things go into it.

**Unicode normalisation.** macOS stores names decomposed, so the umlaut in `Müller.txt` is a plain `u` followed by a combining diaeresis. Windows and Linux store the composed form, one code point. Same file, different bytes. An engine matching on the raw name sees a file that exists only on the left and a different file that exists only on the right, copies each one across, and does the same again next run. The tree grows by two files every time and never settles. Keys are normalised to NFC before anything is compared.

**Case.** If either side cannot tell `Bild.jpg` from `bild.jpg`, matching folds case for the whole job. It has to be one answer for both ends: folding on one side only makes two files over there map onto the one file over here, and the engine oscillates between them. When a side really does hold two names that differ only in case, both are refused and named in the report rather than synced. Copying both onto a case-insensitive destination means the second silently overwrites the first, and the engine would then record that overwrite as a success.

Case sensitivity is read from the backend, not configured. Plain lowercasing is used rather than full Unicode case folding, because filesystem case-insensitivity is not Unicode case folding either: NTFS uses one fixed uppercase table chosen when the volume was formatted.

<br>

## 4. Safety

**Nothing is deleted outright.** A deletion is a move into `.reeveroll/trash/<run>/` on the side that loses the file. The trash sits inside the tree but under a prefix the scanner skips, so it never travels to the other side.

**The mass-delete brake.** A run that would delete more than half the known files stops and says so, with the first paths it would have touched. Below ten deletions it never fires, because deleting three of four files is proportionate and almost certainly meant.

**An empty side is never believed.** If a side lists no files at all while the state says it used to hold some, the run is refused. This is the classic total loss and it is not a bug: a disk fails to mount, the side lists nothing, the engine reads that correctly as "everything was deleted" and correctly deletes it on the other side. Nothing malfunctions. The only defence is to refuse.

The two brakes cover different ground and both are needed. The percentage brake does nothing for a job with five files in it, because five deletions is below its floor. That case is caught only by the refusal to believe an empty side, and there is a test that fails if either one is removed.

**A state row is only written when both sides really do agree.** After every action the engine re-reads the path on both sides and compares. Writing a row for a pair that does not match is how a sync tool stops noticing a difference: the next run compares both sides against a record that already matches them both, concludes nothing changed, and the divergence becomes permanent and invisible. That specific failure stops the run, because it means the engine no longer understands the tree it is working on.

**One file failing does not stop the run.** A transfer that fails is reported as postponed and the next file is attempted. That is safe precisely because the record is only written after success: a file that could not be copied keeps its old row, or none, so the next run tries again. Postponing is not agreeing.

**A crash is survivable at every step.** Records are written per file as it settles, never in one batch at the end, so an interrupted run leaves a state that is smaller than reality but never wrong. Resolving a conflict takes three filesystem operations, and there is a test that kills the run after each of them and demands that a single following run recovers without losing either version. What makes that work is the decision table rather than anything clever in the manoeuvre: a crash leaves the losing side without the plain name while the winner still holds its edited copy, which is the "deleted on one side, edited on the other" row, and that row restores the file instead of propagating the deletion.

<br>

## 5. Filters and half-written files

**The quiet period.** A file is left alone until it has sat unchanged for five seconds. This is not about latency, it is about half-written files: a run that starts while somebody is saving a large document copies whatever is on disk at that instant, and the copy is garbage. A schedule is no defence, since a run every two minutes lands mid-write just as readily as a filesystem watch does.

**The lock probe.** On Windows, a file another program holds exclusively is skipped with that as the reason, instead of surfacing a sharing violation. This is Windows-only by nature and not by omission: Windows locking is mandatory and really does make a file unreadable, while POSIX locks are advisory and do not stop a reader, so elsewhere there is nothing to probe.

**Default excludes.** The names programs use while still writing never travel: `~$*`, `.~lock.*#`, `*.tmp`, `*.temp`, `*.part`, `*.partial`, `*.crdownload`, `*.download`. These exist for seconds, mean nothing on another machine, and a copy of one is a file the other side can never use. `-no-default-excludes` turns that off.

**`-exclude` hides a path from the job entirely**, and that is the dangerous part of any filter. A file that used to be synced and is now excluded has **not** been deleted. An engine that simply drops excluded paths from the listing reads the disappearance as a deletion and removes the file on the other side, so adding one pattern would wipe every file it starts hiding. The exclusion is therefore applied to the stored record as well as to both sides, and there is a test that fails if it is not.

Patterns follow gitignore's instinct: without a slash they match the file name at any depth, with a slash they match the whole relative path. `**` crosses directory separators, `*` and `?` do not, and naming a directory hides everything under it.

<br>

## 6. Running it once

```
go build ./cmd/reeveroll
reeveroll sync -left <path or remote> -right <path or remote> -state <db file> [-dry-run]
```

`-dry-run` prints the plan and changes nothing. Both sides accept anything rclone accepts, so `sftp:backup/photos` and `s3:bucket/photos` work alongside plain paths.

| flag | default | meaning |
|---|---|---|
| `-quiet-period` | 5s | how long a file must sit unchanged before it is touched, 0 disables |
| `-exclude` | - | glob of paths to leave alone entirely, repeatable |
| `-no-default-excludes` | off | also sync half-written files such as `*.part` and Office owner files |
| `-transfers` | 4 | how many files may be copied at the same time |
| `-bwlimit` | - | bandwidth limit in rclone syntax, `1M` or a timetable like `08:00,512k 19:00,off` |
| `-empty-dirs` | off | also carry folders that hold no files |
| `-metadata` | off | carry permissions, ownership and extended attributes where both sides can |
| `-brake-percent` | 50 | refuse a run deleting more than this share of known files, 0 disables |
| `-brake-floor` | 10 | never trip the brake below this many deletions |
| `-mod-window` | 2s | how far modification times may differ and still count as equal |
| `-v` | off | let rclone report what it is doing underneath |

The modification window only ever applies when a side cannot produce a hash. Where hashes exist the comparison is exact, which matters: with a two second window, a file edited twice within two seconds and left at the same length would otherwise be declared unchanged.

<br>

## 7. Running it unattended

A shell history is not a place to keep jobs. Somebody with a photo folder, a documents folder and a server backup has three of them, with different schedules, different filters and different ideas about what may be deleted, so everything past `sync` works from a configuration file. There is a complete one in [reeveroll.example.json](reeveroll.example.json).

```
reeveroll run      -config reeveroll.json <job>    run one job now, whatever its schedule says
reeveroll daemon   -config reeveroll.json          run every scheduled job until stopped
reeveroll jobs     -config reeveroll.json          what is configured, and when each last WORKED
reeveroll history  -config reeveroll.json          what the runs actually did
reeveroll service  -config reeveroll.json          the file this system needs to keep the daemon alive
```

**Everything is validated at load time**, including cron expressions, durations and misspelled field names. A typo that only surfaces at three in the morning, on the one job that mattered, is the failure a daemon must not have. JSON normally ignores a field it does not recognise, so `"excludes"` instead of `"exclude"` would leave the filter empty and sync the very files somebody thought they had excluded; unknown fields are refused instead.

**Paths in the file resolve against the file**, not against whatever directory the service manager happened to start in.

**A job never overlaps itself.** One set to run every fifteen minutes that takes twenty simply lets the next turn go by, with a line in the log. Queueing instead would let a job that is merely too slow build an unbounded backlog of itself. Jobs run one at a time by default, because two of them share one uplink and one disk.

**The bandwidth limit lives at the top of the file, not on a job**, because rclone's token bucket is process-wide. A per-job limit would be a promise the mechanism underneath cannot keep. Everything else is per job, and each one gets its own copy of rclone's settings, so a job asking for eight transfers does not quietly change what another job is doing.

**Every run is written down, successes and failures alike.** The failure worth guarding against is not a crash, which is loud, but a job that has been failing quietly since Tuesday because a path changed. That is also why `jobs` shows when each job last *succeeded* rather than when it last *ran*: a job failing every quarter of an hour looks busy in a log while being of no use at all.

**Notifications default to failures only.** A tool that announces every successful sync teaches its user to ignore it, and then the one message that mattered gets ignored with the rest. Matrix and a plain webhook are supported, and a failure at one destination does not stop the other from firing.

**`service` prints, it does not install.** Registering a service means writing outside the user's own files and, on two of the three systems, asking for administrative rights. What it can do honestly is produce exactly the right unit file, plist or `sc.exe` line, with the things that otherwise get found out the hard way: that a Windows service runs as LocalSystem and therefore cannot see a mapped drive letter, that a Linux user service needs `loginctl enable-linger` to survive a logout, and that macOS will ask for permission the first time the agent touches Documents.

<br>

## 8. Tests

The suite that matters is not a list of cases, it is a property. `TestConvergence` seeds two trees, applies random creates, edits, deletes and renames to both sides for eight rounds, syncs after each, and demands the same thing every time: both sides hold exactly the same files with the same contents.

Around it sit the tests for the things that go wrong quietly rather than loudly: two spellings of one name must not multiply, a newly added exclude pattern must not delete anything, a postponed file must leave the record untouched, a case collision must be refused rather than resolved.

The suite is checked against deliberate sabotage rather than only against itself. Removing the empty-side guard, dropping the second half of conflict resolution, switching off rename detection, removing Unicode normalisation, or filtering the sides without filtering the record each produce a failing test.

```
go test ./...
```

There is one more habit worth naming: every guard here has been checked by breaking it. Removing the empty-side refusal, dropping half of the conflict resolution, switching off rename detection, removing Unicode normalisation, filtering the sides without filtering the record, and letting a naming collision through each produce a failing test. A test that stays green when the thing it protects is removed is testing something else.

CI runs the whole suite on Linux, Windows and macOS, because path handling, modification-time resolution and case sensitivity all differ between them, and every one of those differences is a way for a sync engine to be wrong. The case-collision test can only run where the filesystem can hold both names, so it reports itself as skipped on Windows and macOS.

<br>

## 9. What it will not carry, and what it says about it

**Symbolic links, sockets, pipes, devices and Windows junctions are not synced, and are named in the report.** They have to be found separately: rclone's local backend drops them from its listing after one log line, so a library caller cannot tell one apart from a file that is not there. Following a link would copy the target and turn one shortcut into a full second copy on the other side; storing it as rclone's `.rclonelink` text file would produce something no other program can read. Neither is obviously right, so the engine names them and leaves them alone. Only local sides can be inspected this way, because only a local side has a filesystem underneath to ask.

**Hard links sync as ordinary files.** Two names for the same data arrive as two independent copies. Nothing is lost, but the sharing is.

**Empty directories need `-empty-dirs`, or `"emptyDirs": true`.** A directory holding files is implied by the files; an empty one has nothing to imply it, so it gets a record of its own. That record is what makes removal safe, since "not over there" would otherwise be as ambiguous as it is for a file. Removal goes through `Rmdir`, which refuses a directory that still holds anything, so a folder that still has a postponed file in it survives and the refusal is reported. The whole feature switches itself off when either side is a bucket backend such as S3, where a folder is only a shared key prefix and vanishes on its own. S3 can be persuaded to keep real folder markers by adding `directory_markers=true` to the remote, which is a backend option and needs no flag parsing.

**Rename detection matches on content**, so two unrelated files with identical bytes can in principle be paired.

Still untouched: file watching, and a web interface.

<br>

## 10. Why not just use something that exists

Nothing wrong with the alternatives, and it is worth being honest about them. [Syncthing](https://syncthing.net) is a proven real-time mesh, but it is a mesh of equal devices rather than a directed job, and it does not speak to cloud targets at all. [rclone bisync](https://rclone.org/bisync/) reaches every target but keeps only a listing per side rather than a per-file state, and re-scans both ends on every run.

The gap this fills is the combination: a job-based tool with the reach of rclone, a state database underneath it, and safety brakes that assume the user's disk will eventually fail to mount.
