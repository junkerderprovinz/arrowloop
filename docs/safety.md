# Safety

A two-way sync can destroy data, and the most common way is not a bug in the
code. It is a correctly executed deletion that nobody wanted.

## Nothing is deleted outright unless you said so

A deletion is a move into `.arrowloop/trash/<run>/` on the side that loses the
file. The trash sits inside the tree but under a prefix the scanner skips, so it
never travels to the other side.

Inside the tree rather than beside it, because on an S3 bucket or an SFTP export
there is often no "beside it". The visible cost is that the folder appears in
the synced tree, where everyone using that share can see it.

A job can be configured with `noTrash` to delete outright, and then the folder
is never created. That is a decision about one job's files, not a default: with
it on, a deletion is final and so is the losing side of a conflict.

## The mass-delete brake

A run that would delete more than half the known files stops and says so, naming
the first paths it would have touched. Below ten deletions it never fires,
because deleting three of four files is proportionate and almost certainly what
you meant.

## An empty side is never believed

If a side lists no files at all while the record says it held some, the run is
refused. A job set to [`mirror`](configuration.md#copy-only-mirror-or-move) is
also refused when its source lists nothing and the destination holds files,
with or without a record.

!!! danger "This is the classic total loss, and it is not a bug"
    A disk fails to mount. The side lists nothing. The engine reads that
    correctly as "everything was deleted" and correctly deletes it on the other
    side. Nothing malfunctioned. The only defence is to refuse to believe an
    empty side.

The two brakes cover different ground and both are needed. The percentage brake
does nothing for a job with five files in it, because five deletions is below
its floor; that case is caught only by the refusal above. There is a test that
fails if either one is removed.

## Half-written files

A file is left alone until it has sat unchanged for the quiet period, five
seconds unless the job says otherwise. This is not about latency: a run started
while somebody is saving a large document copies whatever is on disk at that
instant, and the copy is garbage. A schedule is no defence, since a run every
two minutes lands mid-write just as readily as a filesystem watch does.

On Windows, a file another program holds exclusively is skipped with that as the
reason, instead of surfacing a sharing violation. That is Windows-only by
nature: its locking is mandatory and really does make a file unreadable, while
POSIX locks are advisory and do not stop a reader, so elsewhere there is nothing
to probe.

The check covers every kind of action, renames included, not only copies.
After a failure it asks the files directly instead of trusting the error code,
because rclone writes a partial file and renames it into place, and Windows
refuses that rename onto a held file with a plain access-denied rather than a
sharing violation.

With administrator rights, which a Windows service registered through
`arrowloop service` has, such a file is copied from a shadow copy instead of
being postponed. A shadow copy is a frozen view of the whole volume that Windows
keeps beside the live one. ArrowLoop takes one per volume and run, only once a held
file turns up, and removes it when the run ends, since it takes space on that
volume. The record is settled against the shadow copy, so a file that went on
changing is copied again by the next run. Without those rights the reason given
for the skip says so.

What travels is the file as it was at that moment, which for a database is only
as consistent as the database keeps its own file; a `before` command that dumps
or pauses it is the safer way. Renames, removals and conflicts still wait for
the file to be closed, because they change the file itself.

### Default excludes

The names programs use while still writing never travel at all:

```
~$*  .~lock.*#  *.tmp  *.temp  *.part  *.partial  *.crdownload  *.download
```

That is Office owner files, LibreOffice lock files, and the usual half-download
suffixes. They exist for seconds and mean nothing on another machine.
`-no-default-excludes` on the
command line, or `"noDefaultExcludes": true` on a job, turns that off.

## Excluding never deletes

A path that stops being visible has **not** been deleted. An engine that only
drops excluded paths from the listing reads the disappearance as a deletion and
removes the file on the other side, so adding one pattern would wipe every file
it starts hiding. ArrowLoop applies the exclusion to the stored record as well
as to both sides, so adding a pattern hides files rather than removing them, and
a test fails if it does not.

## A record is only written when both sides really agree

After every action the engine re-reads the path on both sides and compares.
Writing a record for a pair that does not match is how a sync tool stops
noticing a difference: the next run compares both sides against a record that
already matches them both, concludes nothing changed, and the divergence becomes
permanent and invisible. That specific failure stops the run, because it means
the engine has lost track of the tree it is working on.

## One file failing does not stop the run

A transfer that fails is reported as postponed and the next file is attempted.
That is safe precisely because the record is only written after success: a file
that could not be copied keeps its old record, or none, so the next run tries
again. Postponing is not agreeing.

## Room is checked before an automatic run starts

A full destination is worse than a failed run. rclone stops mid-transfer, so the
tree ends up holding a partial file, and the record is written per file as each
one finishes, which leaves the record and the disk disagreeing in a way only a
full re-scan resolves. A run the schedule, a watcher or `runAtStart` starts is
therefore worked out first, and refused before anything is copied when its plan
would not fit on a side it writes to.

Of everything the check finds, only a lack of space stops the run. A side that
does not exist yet is created by
the very run being refused, so a check that turned every finding into a refusal
would fail the first run of every new job. A run started by hand is never
refused this way, because somebody pressing the button will read the error, and
the estimate is only an estimate.

## The first run merges

With no record yet, every file on both sides counts as new, so everything on
the left arrives on the right and the other way round. That is the safe
direction to be wrong in: it copies, it never deletes.

Somebody who wants one side to win the first time sets the job's `direction` to
that side, runs it once, and sets it back.

## A consistency check, for the failure nothing else can see

If a record claims the two sides agree when they do not, every later run
compares both against a record that matches both and concludes nothing
happened. The guard above stops such a record being written; a restore, a
crash, a hand edit or a database copied between machines can still produce one.

**Check this job**, in a job's **Options** menu on the Jobs tab, first checks
that the job can run at all, and then compares both sides against the record
and reports what it finds: a file the record says both sides agreed on while
the two copies differ, a record whose two halves describe different files, a
recorded file that is on neither side or only on one, and a file on both sides
the record has never heard of. Each finding is marked with whether any future
run would notice it by itself.

The check changes nothing; repairing is a separate decision.

## A crash is survivable at every step

Records are written per file as it settles, never in one batch at the end, so an
interrupted run leaves a record that is smaller than reality but never wrong.
Resolving a conflict takes three filesystem operations, and there is a test that
kills the run after each of them and demands that a single following run
recovers without losing either version.

That works because of the decision table, not because the three steps are
clever. A crash leaves the losing side without the plain name while the winner
still holds its edited copy. That is the "deleted on one side, edited on the
other" row, which restores the file instead of propagating the deletion.
