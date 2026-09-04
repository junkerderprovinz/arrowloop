<h1 align="center">ReeveRoll</h1>

<p align="center">A two-way file sync engine with a state database, a trash and a brake. Working title, walking skeleton.</p>

## Table of Contents

1. [What this is](#1-what-this-is)
2. [How it decides](#2-how-it-decides)
3. [Safety](#3-safety)
4. [Running it](#4-running-it)
5. [Tests](#5-tests)
6. [What it deliberately does not do yet](#6-what-it-deliberately-does-not-do-yet)
7. [Why not just use something that exists](#7-why-not-just-use-something-that-exists)

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

## 3. Safety

**Nothing is deleted outright.** A deletion is a move into `.reeveroll/trash/<run>/` on the side that loses the file. The trash sits inside the tree but under a prefix the scanner skips, so it never travels to the other side.

**The mass-delete brake.** A run that would delete more than half the known files stops and says so, with the first paths it would have touched. Below ten deletions it never fires, because deleting three of four files is proportionate and almost certainly meant.

**An empty side is never believed.** If a side lists no files at all while the state says it used to hold some, the run is refused. This is the classic total loss and it is not a bug: a disk fails to mount, the side lists nothing, the engine reads that correctly as "everything was deleted" and correctly deletes it on the other side. Nothing malfunctions. The only defence is to refuse.

The two brakes cover different ground and both are needed. The percentage brake does nothing for a job with five files in it, because five deletions is below its floor. That case is caught only by the refusal to believe an empty side, and there is a test that fails if either one is removed.

**A state row is only written when both sides really do agree.** After every action the engine re-reads the path on both sides and compares. Writing a row for a pair that does not match is how a sync tool stops noticing a difference: the next run compares both sides against a record that already matches them both, concludes nothing changed, and the divergence becomes permanent and invisible.

<br>

## 4. Running it

```
go build ./cmd/reeveroll
reeveroll -left <path or remote> -right <path or remote> -state <db file> [-dry-run]
```

`-dry-run` prints the plan and changes nothing. Both sides accept anything rclone accepts, so `sftp:backup/photos` and `s3:bucket/photos` work alongside plain paths.

| flag | default | meaning |
|---|---|---|
| `-brake-percent` | 50 | refuse a run deleting more than this share of known files, 0 disables |
| `-brake-floor` | 10 | never trip the brake below this many deletions |
| `-mod-window` | 2s | how far modification times may differ and still count as equal |
| `-v` | off | let rclone report what it is doing underneath |

The modification window only ever applies when a side cannot produce a hash. Where hashes exist the comparison is exact, which matters: with a two second window, a file edited twice within two seconds and left at the same length would otherwise be declared unchanged.

<br>

## 5. Tests

The suite that matters is not a list of cases, it is a property. `TestConvergence` seeds two trees, applies random creates, edits, deletes and renames to both sides for eight rounds, syncs after each, and demands the same thing every time: both sides hold exactly the same files with the same contents.

The suite has been checked against deliberate sabotage rather than only against itself. Removing the empty-side guard, dropping the second half of conflict resolution, and switching off rename detection each produce a failing test.

```
go test ./...
```

<br>

## 6. What it deliberately does not do yet

No scheduler, no web interface, no job configuration, no filters, no file watching, no service. Empty directories are not synced, because rclone lists objects and an empty directory is not one. Rename detection matches on content, so two unrelated files with identical bytes can in principle be paired.

The plaform edge cases are known and not yet handled: Unicode normalisation between macOS and Windows, case-insensitive against case-sensitive sides, Windows paths over 260 characters. Those are the bulk of the remaining work, not the algorithm.

<br>

## 7. Why not just use something that exists

Nothing wrong with the alternatives, and it is worth being honest about them. [Syncthing](https://syncthing.net) is a proven real-time mesh, but it is a mesh of equal devices rather than a directed job, and it does not speak to cloud targets at all. [rclone bisync](https://rclone.org/bisync/) reaches every target but keeps only a listing per side rather than a per-file state, and re-scans both ends on every run.

The gap this fills is the combination: a job-based tool with the reach of rclone, a state database underneath it, and safety brakes that assume the user's disk will eventually fail to mount.
