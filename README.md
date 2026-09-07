<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.png">
    <img src=".github/assets/banner.png" alt="ArrowLoop" width="100%">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/junkerderprovinz/arrowloop/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/junkerderprovinz/arrowloop/ci.yml?branch=main&label=Build&style=for-the-badge&logo=githubactions&logoColor=white" alt="Build" height="36"></a>&nbsp;
  <a href="https://github.com/junkerderprovinz/arrowloop/actions/workflows/container.yml"><img src="https://img.shields.io/github/actions/workflow/status/junkerderprovinz/arrowloop/container.yml?branch=main&label=Container&style=for-the-badge&logo=githubactions&logoColor=white" alt="Container" height="36"></a>&nbsp;
  <a href="https://github.com/junkerderprovinz/arrowloop/pkgs/container/arrowloop"><img src="https://img.shields.io/badge/Image-ghcr.io-1d99f3?style=for-the-badge&logo=docker&logoColor=white" alt="Image" height="36"></a>&nbsp;
  <a href="https://github.com/junkerderprovinz/arrowloop/pkgs/container/arrowloop"><img src="https://img.shields.io/badge/Arch-amd64%20%7C%20arm64-success?style=for-the-badge&logo=linux&logoColor=white" alt="Arch" height="36"></a>&nbsp;
  <a href="https://rclone.org"><img src="https://img.shields.io/badge/Backends-rclone-3f79b7?style=for-the-badge&logoColor=white" alt="rclone" height="36"></a>&nbsp;
  <a href="https://unraid.net"><img src="https://img.shields.io/badge/Unraid-Template-f15a2c?style=for-the-badge&logo=unraid&logoColor=white" alt="Unraid" height="36"></a>&nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue?style=for-the-badge&logo=gnu&logoColor=white" alt="License: AGPL-3.0" height="36"></a>&nbsp;
  <a href="https://junkerderprovinz.github.io/arrowloop/"><img src="https://img.shields.io/badge/Docs-online-526CFE?style=for-the-badge&logo=materialformkdocs&logoColor=white" alt="Documentation" height="36"></a>
</p>

<br>

<p align="center">A two-way file sync engine with a state database, a trash and a brake, plus the scheduler that keeps it running.</p>

<p align="center">
  <a href="https://www.buymeacoffee.com/junkerderprovinz"><img src=".github/assets/button-buy-me-a-coffee.svg" alt="Buy me a coffee" width="220"></a>
</p>

> [!WARNING]
> **This is not finished, and it is public early on purpose.**
>
> The engine works and is tested hard, on Linux, Windows and macOS. What is not
> yet true is everything a version number under 1.0 usually means: settings move
> between releases, the interface changes shape from one week to the next, and a
> configuration file written today may need a line changed tomorrow. Nothing here
> deletes without a trash and two brakes in the way, and the whole plan is on
> screen before anything moves, so the risk is inconvenience rather than loss.
> Still: **point it at a copy first**, and keep a backup that ArrowLoop is not the
> only guardian of.
>
> It is public because a sync tool nobody can read the source of is a sync tool
> nobody should trust with both sides of their files. Issues and questions are
> welcome; a polished first impression is not the point yet.

## Table of Contents

1. [What this is](#1-what-this-is)
2. [How it decides](#2-how-it-decides)
3. [When two names are one file](#3-when-two-names-are-one-file)
4. [Safety](#4-safety)
5. [Filters and half-written files](#5-filters-and-half-written-files)
6. [Running it once](#6-running-it-once)
7. [Running it unattended](#7-running-it-unattended)
8. [The interface](#8-the-interface)
9. [Installing it](#9-installing-it)
10. [Tests](#10-tests)
11. [What it will not carry, and what it says about it](#11-what-it-will-not-carry-and-what-it-says-about-it)
12. [Why not just use something that exists](#12-why-not-just-use-something-that-exists)
13. [Support this project](#13-support-this-project)

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

**Nothing is deleted outright.** A deletion is a move into `.arrowloop/trash/<run>/` on the side that loses the file. The trash sits inside the tree but under a prefix the scanner skips, so it never travels to the other side.

**The mass-delete brake.** A run that would delete more than half the known files stops and says so, with the first paths it would have touched. Below ten deletions it never fires, because deleting three of four files is proportionate and almost certainly meant.

**An empty side is never believed.** If a side lists no files at all while the state says it used to hold some, the run is refused. This is the classic total loss and it is not a bug: a disk fails to mount, the side lists nothing, the engine reads that correctly as "everything was deleted" and correctly deletes it on the other side. Nothing malfunctions. The only defence is to refuse.

The two brakes cover different ground and both are needed. The percentage brake does nothing for a job with five files in it, because five deletions is below its floor. That case is caught only by the refusal to believe an empty side, and there is a test that fails if either one is removed.

**A state row is only written when both sides really do agree.** After every action the engine re-reads the path on both sides and compares. Writing a row for a pair that does not match is how a sync tool stops noticing a difference: the next run compares both sides against a record that already matches them both, concludes nothing changed, and the divergence becomes permanent and invisible. That specific failure stops the run, because it means the engine no longer understands the tree it is working on.

**One file failing does not stop the run.** A transfer that fails is reported as postponed and the next file is attempted. That is safe precisely because the record is only written after success: a file that could not be copied keeps its old row, or none, so the next run tries again. Postponing is not agreeing.

**Room is checked before an automatic run starts.** A full destination is worse than a failed run: rclone stops mid-transfer, so the tree ends up holding a partial file, and the record is written per file as each one finishes, which leaves the record and the disk disagreeing in a way only a full re-scan resolves. A scheduled run whose plan would not fit is therefore refused before anything is opened. Only the space finding stops it: a side that does not exist yet is created by the very run being refused, so a check that turned every finding into a refusal would fail the first run of every new job. A run started by hand is never refused, because somebody pressing the button will read the error and the estimate is a floor rather than a peak.

**The first run can be told which side is right.** With no record yet, every file on both sides counts as new, so the default merges them, and by the time somebody notices the other side is full of files they meant to leave behind. `firstRun` takes `left` or `right` and applies exactly once: that side wins every disagreement and a file it never had is left exactly where it is. Seeding copies, it does not mirror. As soon as a record exists the setting is ignored, so one left in the file cannot quietly turn a two-way job into a one-way one.

**A consistency check, for the failure nothing else can see.** If a row claims the two sides agree when they do not, every later run compares both against a record that matches both and concludes nothing happened. The guard above stops that row being written; a restore, a crash, a hand edit or a database copied between machines can still produce one. The check compares both sides against the record and reports what it finds, marking each finding with whether any future run would notice it by itself. It changes nothing: repairing is a separate decision.

**A crash is survivable at every step.** Records are written per file as it settles, never in one batch at the end, so an interrupted run leaves a state that is smaller than reality but never wrong. Resolving a conflict takes three filesystem operations, and there is a test that kills the run after each of them and demands that a single following run recovers without losing either version. What makes that work is the decision table rather than anything clever in the manoeuvre: a crash leaves the losing side without the plain name while the winner still holds its edited copy, which is the "deleted on one side, edited on the other" row, and that row restores the file instead of propagating the deletion.

<br>

## 5. Filters and half-written files

**The quiet period.** A file is left alone until it has sat unchanged for five seconds. This is not about latency, it is about half-written files: a run that starts while somebody is saving a large document copies whatever is on disk at that instant, and the copy is garbage. A schedule is no defence, since a run every two minutes lands mid-write just as readily as a filesystem watch does.

**The lock probe.** On Windows, a file another program holds exclusively is skipped with that as the reason, instead of surfacing a sharing violation. This is Windows-only by nature and not by omission: Windows locking is mandatory and really does make a file unreadable, while POSIX locks are advisory and do not stop a reader, so elsewhere there is nothing to probe. It covers every kind of action rather than copies alone, including renames, and it asks the files directly after a failure rather than trusting an error code: rclone writes a partial file and renames it into place, and Windows refuses that rename onto a held file with plain access-denied instead of a sharing violation.

**Default excludes.** The names programs use while still writing never travel: `~$*`, `.~lock.*#`, `*.tmp`, `*.temp`, `*.part`, `*.partial`, `*.crdownload`, `*.download`. These exist for seconds, mean nothing on another machine, and a copy of one is a file the other side can never use. `-no-default-excludes` turns that off.

**`-exclude` hides a path from the job entirely**, and that is the dangerous part of any filter. A file that used to be synced and is now excluded has **not** been deleted. An engine that simply drops excluded paths from the listing reads the disappearance as a deletion and removes the file on the other side, so adding one pattern would wipe every file it starts hiding. The exclusion is therefore applied to the stored record as well as to both sides, and there is a test that fails if it is not.

Patterns follow gitignore's instinct: without a slash they match the file name at any depth, with a slash they match the whole relative path. `**` crosses directory separators, `*` and `?` do not, and naming a directory hides everything under it.

<br>

## 6. Running it once

```
go build ./cmd/arrowloop
arrowloop sync -left <path or remote> -right <path or remote> -state <db file> [-dry-run]
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

A shell history is not a place to keep jobs. Somebody with a photo folder, a documents folder and a server backup has three of them, with different schedules, different filters and different ideas about what may be deleted, so everything past `sync` works from a configuration file. There is a complete one in [arrowloop.example.json](arrowloop.example.json).

```
arrowloop run      -config arrowloop.json <job>    run one job now, whatever its schedule says
arrowloop daemon   -config arrowloop.json          run every scheduled job until stopped
arrowloop jobs     -config arrowloop.json          what is configured, and when each last WORKED
arrowloop history  -config arrowloop.json          what the runs actually did
arrowloop service  -config arrowloop.json          the file this system needs to keep the daemon alive
arrowloop version                                  which build this is
```

**Everything is validated at load time**, including cron expressions, durations and misspelled field names. A typo that only surfaces at three in the morning, on the one job that mattered, is the failure a daemon must not have. JSON normally ignores a field it does not recognise, so `"excludes"` instead of `"exclude"` would leave the filter empty and sync the very files somebody thought they had excluded; unknown fields are refused instead.

**Paths in the file resolve against the file**, not against whatever directory the service manager happened to start in.

**A job never overlaps itself.** One set to run every fifteen minutes that takes twenty simply lets the next turn go by, with a line in the log. Queueing instead would let a job that is merely too slow build an unbounded backlog of itself. Jobs run one at a time by default, because two of them share one uplink and one disk.

**The bandwidth limit lives at the top of the file, not on a job**, because rclone's token bucket is process-wide. A per-job limit would be a promise the mechanism underneath cannot keep. It is also checked when the file is read and applied to the running process the moment it is saved. Neither of those was true before: a typo saved cleanly and the program then refused to start on the next boot, with the message on a console and the interface that could have shown it gone, and a limit that saved correctly went on being ignored until somebody restarted. Everything else is per job, and each one gets its own copy of rclone's settings, so a job asking for eight transfers does not quietly change what another job is doing.

**Real time is one of the schedules, not a switch beside them.** Picking it in the schedule strip sets `"watch": true` and makes a run start when a local side changes. The reason is not latency: a schedule has to list both sides in full on every tick, which on a large tree or over a network is most of what a run costs, and watching lets the engine sit still until there is a reason not to.

It never replaces the schedule, and the configuration refuses a watching job that has none, so picking real time writes a BACKSTOP as well: an hourly cadence, shown right there and editable. The backstop is the visible half of a promise that used to be implied. Only a local side can be watched, most remote backends have no way to tell anyone anything, and a watcher that missed an event has no way to know it did; the schedule is what eventually notices what the watcher did not. Events are collected over a settle window, because copying a folder in produces one event per file and the interesting fact is that something changed. A new folder is watched as it appears, since the kernel reports on a directory's own entries rather than its whole subtree. The tool's own trash and every excluded path are ignored, and a job's watcher is muted around its own runs, or the engine would spend its life answering its own writes.

**Every run is written down, successes and failures alike.** The failure worth guarding against is not a crash, which is loud, but a job that has been failing quietly since Tuesday because a path changed. That is also why `jobs` shows when each job last *succeeded* rather than when it last *ran*: a job failing every quarter of an hour looks busy in a log while being of no use at all.

**Settings the engine reads now have somewhere to be set.** The bandwidth limit, how many jobs may run at once, where the run log lives, who gets told, and the two brakes: all of these were read by the engine and settable only by editing the file. They sit under Settings, on their own tab. What is usually the same for every job lives there as a default and a job keeps only what makes it different, so the job form stays short.

**A shared exclude list is written once and asked for by name.** The alternative is the same twenty lines pasted into every job, drifting apart until two jobs that were meant to ignore the same things quietly stop doing so. A job asking for a list that does not exist is refused when the file is read: a filter that silently matches nothing does not break anything, it just quietly syncs the thing somebody asked it to leave alone.


**Notifications default to failures only.** A tool that announces every successful sync teaches its user to ignore it, and then the one message that mattered gets ignored with the rest. Matrix and a plain webhook are supported, and a failure at one destination does not stop the other from firing.

**`service` prints, it does not install.** Registering a service means writing outside the user's own files and, on two of the three systems, asking for administrative rights. What it can do honestly is produce exactly the right unit file, plist or `sc.exe` line, with the things that otherwise get found out the hard way: that a Windows service runs as LocalSystem and therefore cannot see a mapped drive letter, that a Linux user service needs `loginctl enable-linger` to survive a logout, and that macOS will ask for permission the first time the agent touches Documents.

<br>

## 8. The interface

```
arrowloop web -config arrowloop.json          # http://127.0.0.1:8422, schedules included
```

**The preview is the screen the product exists for.** Every other sync tool's main view is a progress bar, which is a report on a decision somebody already made for you. Here every proposed change is listed with its direction and the reason the engine gives for it, each row can be unticked, and nothing moves until the button is pressed.

Ticking is not decoration. The run re-plans and then keeps only the paths that were ticked, rather than replaying the plan that was on screen: between reading a preview and pressing the button a file can change, and acting on the older plan would mean acting on a description of a tree that no longer exists. An empty selection stays distinguishable from no selection at all, so unticking every row does nothing rather than running everything.

**Jobs are made and edited on the same tab they are watched on.** The plus adds one and opens it, the pencil on a row opens that row, and the form appears under the list. It writes the same configuration file a person can still open in an editor, and it validates through the same function that guards it there: a refused edit fails in the validator's own words and leaves the file exactly as it was, because the new content is written beside it and only moved into place once it has passed. A saved edit rebuilds the schedules and the watchers without a restart.

**A new job arrives switched on.** It used to arrive held, purely so that the validator would accept it before it had any sides, which meant every job anybody created announced itself as disabled until they found a switch at the bottom of the form. A job with NEITHER side is a draft now and loads fine: it has no schedule, so nothing reaches it, and pressing the button on it gets the same sentence the file used to be refused with. A job with ONE side and not the other is still refused when it is switched on, because that is not a draft, it is a form half filled in. The one exception is a DUPLICATE, which arrives held on purpose: it points at the same two folders as the job it was copied from, with a state database of its own, and two such jobs on one schedule would compare the same files against two different records.

**A schedule is built rather than typed.** The stored value is still a cron expression, because that is what the engine reads and what a hand-edited file contains, but the two common answers are pickers: every day at a time, or certain weekdays at a time, with an hour and minute list rather than a typed field. An expression the builder cannot express is never rewritten; it stays in the raw field exactly as written, since an editor that simplified a schedule it did not understand would destroy the thing it was opened to look at.

**What is happening right now has a card of its own**, at the top of the jobs tab: which job, which file, how far. It arrives as it happens rather than being polled for, and it says so in one line when nothing is running rather than disappearing, because a panel that vanishes when idle leaves somebody wondering which of the two it is.

**A job's direction is an arrow**, in the list and in the editor: both ways, left to right, or right to left. A one-way job does not simply drop the changes that point the wrong way, because dropping them would leave the two sides further apart with every run. It **rebuilds** them: a file edited on the destination is restored from the source, and a file deleted there is copied back, so a one-way job converges on the source rather than drifting. What the source never had is left alone, since nothing there says it should exist.

**The look is [GlimStone](https://github.com/junkerderprovinz/glimstone) 1.7.6**, and its reference tokens and appearance engine are copied in verbatim rather than reimplemented. Theme, corner shape and accent are the viewer's to set. The accent marks activity and nothing else, which is why the switches down the preview are deliberately colourless: every row arrives ticked, and a control that is on in all of them is not activity.

**It listens on loopback by default,** and it can ask for a password. This interface starts jobs that delete files, so an install anybody on the network can reach is an install anybody on the network can drive. Set `ARROWLOOP_PASSWORD_HASH` and every route but the login itself needs a session; leave it unset and nothing changes at all, which is what every install does today. The hash deliberately does not live in the configuration file, because that file is served whole as a backup and can be replaced whole by a restore: a hash there would be handed out over the routes it protects, and restoring an older backup would switch protection off without a word. Over plain HTTP the session cookie still crosses the wire in clear, so a machine reachable from outside wants TLS in front of it either way.

**The history opens.** A row says twelve copied and two conflicts; clicking it says which files, and for a conflict what was decided. That last part is the one worth having: a scheduled run resolves a conflict by keeping both versions because it has nobody to ask, so the decision was made on somebody's behalf while they were not watching, and until now nothing ever mentioned it. The decision can be revisited from there, which starts a fresh run for exactly those paths rather than rewriting what the first run did.

**A month of runs is drawn above the list.** The list answers what happened on Tuesday; it cannot answer whether the thing is doing anything at all, which is the question somebody has after leaving it alone for three weeks. Days with no runs are drawn as empty columns rather than left out, because a chart that closes its gaps turns "nothing happened" into "nothing to show".

`arrowloop daemon` is the same scheduler without the interface, for a machine where nobody is looking.

<br>

## 9. Installing it

**As a container**, which is what an Unraid box wants:

```
docker run -d --name arrowloop -p 8422:8422   -v /mnt/user/appdata/arrowloop:/config   -v /mnt/user:/data   ghcr.io/junkerderprovinz/arrowloop:latest
```

`/config` holds `arrowloop.json`, one state database per job and the run log, and it is the directory that must survive the container: without those databases every job forgets what the two sides agreed on and treats every file as new. A first start on an empty `/config` writes a starter configuration with one disabled example job, so the interface comes up and can be edited rather than crash-looping on a missing file. The Unraid template is [templates/my-ArrowLoop.xml](templates/my-ArrowLoop.xml).

The image carries no second executable. rclone is compiled in as a library, so there is no version skew between the tool and the thing it drives, and nothing to keep separately up to date.

**As a desktop application** on Windows, Linux or macOS, from the release page. Windows gets two files that are the same program: an installer that puts it in the Start menu and under Apps, and a portable exe that runs from wherever you leave it. It is not a client talking to a server: the scheduler, the run log and the API all live in the same process, and the window is a webview pointed at them. Nothing listens on the network at all, which is the difference between a desktop app and a server somebody did not ask to run. The schedules run for as long as the window is open; for a machine that should sync while nobody is looking, `arrowloop daemon` and `arrowloop service` are the right pair.

**Settings, General, Starting** registers it to start when you sign in. It is a per-user entry (`HKCU` on Windows, `~/.config/autostart` on Linux, a LaunchAgent on macOS), so it needs no administrator rights and touches nobody else on the machine. The switch reads its state back from the system rather than from a settings file, so removing the entry with the Task Manager's own startup tab turns the switch off too, instead of leaving it claiming something that is no longer true. Autostart alone only gets the program running: a job that should sync *because* the machine just came on wants `runAtStart` as well, or it sits there until its schedule is next due.

**Every build says which build it is**, and in three places that cannot disagree because they read one stamp: the Windows properties dialog under Product version, `arrowloop version` on the command line, and the About card. A build from a tag says the tag, one from a commit says the commit, and one from an edited tree adds `-dirty`, because a binary made from uncommitted changes is not the commit it names.

The desktop builds are **not signed**. Windows shows its blue warning on first start (More info, Run anyway), and macOS needs a right-click and Open the first time. That is a deliberate trade for now rather than an oversight: a certificate is a recurring cost, and it is worth paying once there are users to pay it for.

**It sits in the notification area**, and Settings, General decides what the window buttons do: whether closing quits or hides, and whether minimising goes to the taskbar or to the icon. Closing quits by default, because a close button that quietly leaves a program running is the kind of surprise somebody finds a week later while wondering why a job keeps firing. Both choices switch off together with the icon, since a window that hides with nothing left to bring it back is gone. Starting the program a second time brings the running window back rather than opening a second copy.

Wails v2 has no tray of its own, so this is `energye/systray`, which is the fork that does not demand the main thread on macOS. The icon is built around the same PNG the window wears, at startup, rather than committed as a second file: two icon files are two things to remember when the logo changes, and the day one is forgotten is the day the window and the notification area wear different marks. **Verified by hand on Windows only**; the other two builds are compiled but untested.

<br>

## 10. Tests

The suite that matters is not a list of cases, it is a property. `TestConvergence` seeds two trees, applies random creates, edits, deletes and renames to both sides for eight rounds, syncs after each, and demands the same thing every time: both sides hold exactly the same files with the same contents.

Around it sit the tests for the things that go wrong quietly rather than loudly: two spellings of one name must not multiply, a newly added exclude pattern must not delete anything, a postponed file must leave the record untouched, a case collision must be refused rather than resolved.

The suite is checked against deliberate sabotage rather than only against itself. Removing the empty-side guard, dropping the second half of conflict resolution, switching off rename detection, removing Unicode normalisation, or filtering the sides without filtering the record each produce a failing test.

```
go test ./...
```

One side of every test above is a local folder, and for a long time so was the other. The engine is also exercised against a **bucket-shaped backend** now: no real directories, no filesystem underneath, a rename that has to become a copy and a delete. That is not a substitute for running against a real S3 bucket or SFTP host and is not claimed as one, but it is the part of that gap which can be closed without asking anybody for a server, and closing it immediately found a defect: a job could not start at all against a destination that did not exist yet.

There is one more habit worth naming: every guard here has been checked by breaking it. Removing the empty-side refusal, dropping half of the conflict resolution, switching off rename detection, removing Unicode normalisation, filtering the sides without filtering the record, and letting a naming collision through each produce a failing test. A test that stays green when the thing it protects is removed is testing something else.

CI runs the whole suite on Linux, Windows and macOS, because path handling, modification-time resolution and case sensitivity all differ between them, and every one of those differences is a way for a sync engine to be wrong. The case-collision test can only run where the filesystem can hold both names, so it reports itself as skipped on Windows and macOS.

<br>

## 11. What it will not carry, and what it says about it

**Symbolic links, sockets, pipes, devices and Windows junctions are not synced, and are named in the report.** They have to be found separately: rclone's local backend drops them from its listing after one log line, so a library caller cannot tell one apart from a file that is not there. Following a link would copy the target and turn one shortcut into a full second copy on the other side; storing it as rclone's `.rclonelink` text file would produce something no other program can read. Neither is obviously right, so the engine names them and leaves them alone. Only local sides can be inspected this way, because only a local side has a filesystem underneath to ask.

**Hard links sync as ordinary files.** Two names for the same data arrive as two independent copies. Nothing is lost, but the sharing is.

**Empty directories need `-empty-dirs`, or `"emptyDirs": true`.** A directory holding files is implied by the files; an empty one has nothing to imply it, so it gets a record of its own. That record is what makes removal safe, since "not over there" would otherwise be as ambiguous as it is for a file. Removal goes through `Rmdir`, which refuses a directory that still holds anything, so a folder that still has a postponed file in it survives and the refusal is reported. The whole feature switches itself off when either side is a bucket backend such as S3, where a folder is only a shared key prefix and vanishes on its own. S3 can be persuaded to keep real folder markers by adding `directory_markers=true` to the remote, which is a backend option and needs no flag parsing.

**Rename detection matches on content**, so two unrelated files with identical bytes can in principle be paired.



<br>

## 12. Why not just use something that exists

Nothing wrong with the alternatives, and it is worth being honest about them. [Syncthing](https://syncthing.net) is a proven real-time mesh, but it is a mesh of equal devices rather than a directed job, and it does not speak to cloud targets at all. [rclone bisync](https://rclone.org/bisync/) reaches every target but keeps only a listing per side rather than a per-file state, and re-scans both ends on every run.

The gap this fills is the combination: a job-based tool with the reach of rclone, a state database underneath it, and safety brakes that assume the user's disk will eventually fail to mount.

<br>

## 13. Support this project

ArrowLoop is free and stays free. It is written in evenings and at weekends, and
a donation keeps the lights on rather than buying anything: the domain, the
server the documentation is served from, and the evenings themselves.

<p align="center">
  <a href="https://www.buymeacoffee.com/junkerderprovinz"><img src=".github/assets/button-buy-me-a-coffee.svg" alt="Buy me a coffee" width="220"></a>
</p>

Reporting something that went wrong is worth as much. A two-way sync meets
filesystems, network shares and timing that no test suite can reach on its own,
and the bugs that matter here are the quiet ones. If a run did something you did
not expect, open an [issue](https://github.com/junkerderprovinz/arrowloop/issues)
with the run's own log line: it names the job, the file and the reason.
