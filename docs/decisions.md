# How it decides

Everything hangs on a three-way comparison: the current left side, the current
right side, and what the two agreed on last time. Without that third term, "the file is
here but not there" is ambiguous, and the two readings call for opposite
actions.

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

Even with a hash, rename detection matches on content, so two unrelated files
with identical bytes can in principle be paired.

## When two names are one file

A file is matched by a **key**, not by its name. The name stays with the side it
came from and is what gets handed to the backend; the key exists only to line
the two sides up against each other and against the record. Two things go into
it.

**Unicode normalisation.** macOS stores names decomposed, so the umlaut in
`Müller.txt` is a plain `u` followed by a combining diaeresis. Windows and Linux
store the composed form, one code point. Same file, different bytes. An engine
matching on the raw name sees a file that exists only on the left and a
different file that exists only on the right, copies each one across, and does
the same again next run: the tree grows by two files every time and never
settles. Keys are normalised to NFC before anything is compared.

**Case.** If either side cannot tell `Bild.jpg` from `bild.jpg`, matching folds
case for the whole job. It has to be one answer for both ends: folding on one
side only makes two files over there map onto the one file over here, and the
engine oscillates between them. When a side really does hold two names
differing only in case, both are refused and named in the report rather than
synced. Copying both onto a case-insensitive destination means the second
silently overwrites the first, and the engine would then record that overwrite
as a success.

Case sensitivity is read from the backends, not guessed from the operating
system. Plain lowercasing is used rather than full Unicode case folding, because
filesystem case-insensitivity is not Unicode case folding either: NTFS uses one
fixed uppercase table chosen when the volume was formatted.

A backend can answer wrongly. A Windows share mounted on Linux reports itself
case-sensitive and is not, and the pair then grows by one file per run. For
that case `foldCase` on the job, or in the defaults, overrides what the
backends say; see [Configuring a job](configuration.md#upper-and-lower-case).

## What it will not carry

Symbolic links, sockets, pipes, devices and Windows junctions are not synced,
and are **named in the report**. rclone's local backend drops them from its
listing after one log line, so a library caller cannot tell one apart from a
file that is not there, and they have to be found separately. Saying nothing
would be the worst outcome, since you would be told the folder is in sync while
part of it was never looked at. Only local sides can be inspected this way,
because only a local side has a filesystem underneath to ask.

Following a link would turn one shortcut into a second full copy on the other
side; writing rclone's `.rclonelink` text file would produce something nothing
else can read. Neither is obviously right, so they are reported and left.

Hard links sync as ordinary files: two names for the same data arrive as two
independent copies. Nothing is lost, but the sharing is.

### Empty directories

Empty directories travel only with `-empty-dirs` on the command line, or
`"emptyDirs": true` on a job. A directory holding files is implied by the files;
an empty one has nothing to imply it, so it gets a record of its own. That
record is what makes removal safe, since "not over there" would otherwise be as
ambiguous for a folder as it is for a file.

Removal goes through `Rmdir`, which refuses a directory that still holds
anything, so a folder that still has a postponed file in it survives and the
refusal is reported.

The whole feature switches itself off when either side is a bucket backend such
as S3, where a folder is only a shared key prefix and vanishes on its own. S3
can be persuaded to keep real folder markers by adding `directory_markers=true`
to the remote, which is a backend option and needs no flag of ArrowLoop's.
