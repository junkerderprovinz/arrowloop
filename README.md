<h1 align="center">ReeveRoll</h1>

<p align="center">A two-way file sync engine with a state database, a trash and a brake. Working title, walking skeleton.</p>

## Table of Contents

1. [What this is](#1-what-this-is)
2. [How it decides](#2-how-it-decides)
3. [When two names are one file](#3-when-two-names-are-one-file)
4. [Safety](#4-safety)
5. [Filters and half-written files](#5-filters-and-half-written-files)
6. [Running it](#6-running-it)
7. [Tests](#7-tests)
8. [What it deliberately does not do yet](#8-what-it-deliberately-does-not-do-yet)
9. [Why not just use something that exists](#9-why-not-just-use-something-that-exists)

<br>

## 1. What this is

The engine of a self-hosted GoodSync replacement, cut down to the part that can lose data, so that part can be proved before anything is built on top of it.

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

<br>

## 5. Filters and half-written files

**The quiet period.** A file is left alone until it has sat unchanged for five seconds. This is not about latency, it is about half-written files: a run that starts while somebody is saving a large document copies whatever is on disk at that instant, and the copy is garbage. A schedule is no defence, since a run every two minutes lands mid-write just as readily as a filesystem watch does.

**The lock probe.** On Windows, a file another program holds exclusively is skipped with that as the reason, instead of surfacing a sharing violation. This is Windows-only by nature and not by omission: Windows locking is mandatory and really does make a file unreadable, while POSIX locks are advisory and do not stop a reader, so elsewhere there is nothing to probe.

**Default excludes.** The names programs use while still writing never travel: `~$*`, `.~lock.*#`, `*.tmp`, `*.temp`, `*.part`, `*.partial`, `*.crdownload`, `*.download`. These exist for seconds, mean nothing on another machine, and a copy of one is a file the other side can never use. `-no-default-excludes` turns that off.

**`-exclude` hides a path from the job entirely**, and that is the dangerous part of any filter. A file that used to be synced and is now excluded has **not** been deleted. An engine that simply drops excluded paths from the listing reads the disappearance as a deletion and removes the file on the other side, so adding one pattern would wipe every file it starts hiding. The exclusion is therefore applied to the stored record as well as to both sides, and there is a test that fails if it is not.

Patterns follow gitignore's instinct: without a slash they match the file name at any depth, with a slash they match the whole relative path. `**` crosses directory separators, `*` and `?` do not, and naming a directory hides everything under it.

<br>

## 6. Running it

```
go build ./cmd/reeveroll
reeveroll -left <path or remote> -right <path or remote> -state <db file> [-dry-run]
```

`-dry-run` prints the plan and changes nothing. Both sides accept anything rclone accepts, so `sftp:backup/photos` and `s3:bucket/photos` work alongside plain paths.

| flag | default | meaning |
|---|---|---|
| `-quiet-period` | 5s | how long a file must sit unchanged before it is touched, 0 disables |
| `-exclude` | - | glob of paths to leave alone entirely, repeatable |
| `-no-default-excludes` | off | also sync half-written files such as `*.part` and Office owner files |
| `-brake-percent` | 50 | refuse a run deleting more than this share of known files, 0 disables |
| `-brake-floor` | 10 | never trip the brake below this many deletions |
| `-mod-window` | 2s | how far modification times may differ and still count as equal |
| `-v` | off | let rclone report what it is doing underneath |

The modification window only ever applies when a side cannot produce a hash. Where hashes exist the comparison is exact, which matters: with a two second window, a file edited twice within two seconds and left at the same length would otherwise be declared unchanged.

<br>

## 7. Tests

The suite that matters is not a list of cases, it is a property. `TestConvergence` seeds two trees, applies random creates, edits, deletes and renames to both sides for eight rounds, syncs after each, and demands the same thing every time: both sides hold exactly the same files with the same contents.

Around it sit the tests for the things that go wrong quietly rather than loudly: two spellings of one name must not multiply, a newly added exclude pattern must not delete anything, a postponed file must leave the record untouched, a case collision must be refused rather than resolved.

The suite is checked against deliberate sabotage rather than only against itself. Removing the empty-side guard, dropping the second half of conflict resolution, switching off rename detection, removing Unicode normalisation, or filtering the sides without filtering the record each produce a failing test.

```
go test ./...
```

CI runs the whole suite on Linux, Windows and macOS, because path handling, modification-time resolution and case sensitivity all differ between them, and every one of those differences is a way for a sync engine to be wrong. The case-collision test can only run where the filesystem can hold both names, so it reports itself as skipped on Windows and macOS.

<br>

## 8. What it deliberately does not do yet

No scheduler, no web interface, no job configuration, no file watching, no service. Empty directories are not synced, because rclone lists objects and an empty directory is not one. Rename detection matches on content, so two unrelated files with identical bytes can in principle be paired.

Windows paths over 260 characters, symbolic links, permissions and extended attributes are all untouched territory.

<br>

## 9. Why not just use something that exists

Nothing wrong with the alternatives, and it is worth being honest about them. [Syncthing](https://syncthing.net) is a proven real-time mesh, but it is a mesh of equal devices rather than a directed job, and it does not speak to cloud targets at all. [rclone bisync](https://rclone.org/bisync/) reaches every target but keeps only a listing per side rather than a per-file state, and re-scans both ends on every run.

The gap this fills is the combination: a job-based tool with the reach of rclone, a state database underneath it, and safety brakes that assume the user's disk will eventually fail to mount.
