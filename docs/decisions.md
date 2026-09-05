# How it decides

Everything hangs on a three-way comparison: the left side now, the right side
now, and what the two agreed on last time.

| left \ right | untouched | changed | deleted | new |
|---|---|---|---|---|
| **untouched** | nothing | copy right to left | delete on left | - |
| **changed** | copy left to right | conflict, keep both | restore, the edit wins | - |
| **deleted** | delete on right | restore, the edit wins | drop the record | - |
| **new** | - | - | - | identical: record it. different: conflict |

Two of those cells are judgement rather than logic.

**An edit beats a deletion.** When one side deleted a file and the other edited
it, the file comes back. A deletion can be repeated by hand in a second; an edit
that was thrown away cannot be recovered from anywhere.

**A conflict keeps both versions and still converges.** The newer file keeps the
plain name on both sides, and the older is preserved next to it as
`name.conflict-<side>-<timestamp>.ext`, on both sides. Refusing to resolve would
look safer and would in fact leave the job permanently stuck, reporting the same
conflict on every run forever.

## Renames

A delete on one side plus a create on the same side with identical content is
folded into a single move, so renaming a folder of photos does not re-upload
them.

Rename detection needs a real hash on both the record and the new file. A
backend that cannot produce one gets a copy and a delete instead, which is
slower and still correct. Matching on size alone would happily pair two
unrelated files that happen to be the same length.

## When two names are one file

A file is matched by a **key**, not by its name. The name stays with the side it
came from and is what gets handed to the backend.

**Unicode normalisation.** macOS stores names decomposed, so the umlaut in
`Müller.txt` is a plain `u` followed by a combining mark. Windows and Linux
store the composed form. Same file, different bytes. An engine matching on the
raw name copies each one to the other side and does it again next run: the tree
grows by two files every time and never settles.

**Case.** If either side cannot tell `Bild.jpg` from `bild.jpg`, matching folds
case for the whole job. It has to be one answer for both ends. When a side
really does hold two names differing only in case, both are refused and named in
the report rather than synced, because copying both onto a case-insensitive
destination means the second silently overwrites the first.

## What it will not carry

Symbolic links, sockets, pipes, devices and Windows junctions are not synced,
and are **named in the report**. rclone drops them from its listing after one
log line, so they have to be found separately; saying nothing would be the worst
outcome, since you would be told the folder is in sync while part of it was
never looked at.

Following a link would turn one shortcut into a second full copy on the other
side; writing rclone's `.rclonelink` text file would produce something nothing
else can read. Neither is obviously right, so they are reported and left.

Hard links sync as ordinary files: two names for the same data arrive as two
independent copies. Nothing is lost, but the sharing is.
