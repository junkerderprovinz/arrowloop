# Safety

A two-way sync can destroy data, and the most common way is not a bug in the
code. It is a correctly executed deletion that nobody wanted.

## Nothing is deleted outright unless you said so

A deletion is a move into `.arrowloop/trash/<run>/` on the side that loses the
file. The trash sits inside the tree but under a prefix the scanner skips, so it
never travels to the other side.

Inside the tree rather than beside it, because on an S3 bucket or an SFTP export
there is often no "beside it". The visible cost is that the folder appears in
the synced tree, where everyone using that share can see it. On Windows
ArrowLoop sets the hidden attribute on it on every side that is a folder, a
drive or a share, and on macOS and Linux the leading dot hides it. A cloud
target has no such attribute, so there it shows.

A job can be configured with `noTrash` to delete outright, and then the folder
is never created. That is a decision about one job's files, not a default: with
it on, a deletion is final and so is the losing side of a conflict.

## The mass-delete brake

A run that would delete more than half the known files stops and says so, naming
the first paths it would have touched. Below ten deletions it never fires,
because deleting three of four files is proportionate and almost certainly what
you meant.

## The mass-change brake

A run that would overwrite more than half the known files stops the same way.
That is what a tree looks like after something encrypted it in place: every
name still there, every content different. A new file is no change and neither
is a rename, since neither replaces anything. Both brakes share the floor of
ten.

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

## A refused run holds the job

A brake does not fail the run. It holds the job and lists it under Anomalies,
as a card with the figures, the files it counted and the two answers below.
With the anomaly notes switched off the same card stands on the job's page. Every later run of that job, on its
schedule or by hand, stops at the same place until one of three things happens:

**Run anyway** lets the change run now. The permission covers the change as it
was shown: if more files have gone since, the brake refuses again with the new
figures. A run that overwrites in bulk keeps the content it replaces as a
version, even on a job that keeps none.

**Take back** undoes the change where it was made. Files one side lost are
copied back from the other, and files one side rewrote get the other side's
content again, with the rewritten content kept as a version. Nothing is
deleted. For an emptied side that means copying everything back onto it, so
check first that it is the right, mounted place.

The third is that the cause goes away. Once a run finds nothing left to refuse,
the finding closes by itself, so a share that was not mounted needs no answer,
only the mount.

A held job is not a failed one: it is not retried every few minutes, it does
not count towards the note below, and nothing is written to the run log until
it runs again.

Two more findings hold nothing. One says a job has failed several times in a
row, three unless set otherwise. The other says a scheduled job has missed its
turn for more than two days. Either can be acknowledged, and then stays away
until its cause has gone and come back.

A held job is reported where runs report to. The notes are not, unless
`anomalies.notifyNotes` is switched on; see
[Configuration](configuration.md#anomalies).

## Unusual runs

A brake knows only shares of a job's files. A job that usually deletes nothing
and one day deletes 400 of its 10,000 files stays far below the mass-delete
brake, and still did something it never does. So ArrowLoop learns what each
job's runs usually do and makes a note when one does far more.

It learns from the job's last fifty successful runs, older ones do not count,
and judges a run only once ten are there to learn from. Until then the job is
learning and nothing is noted; the rings on the Anomalies page show how far
each job has got. Three figures are learned: the files a run deleted, the files
it copied, and how long it took.

A figure is unusual when it lies more than six median absolute deviations above
the median of the learned runs, and also past a floor: twenty deleted files,
fifty copied files, or five minutes longer than the median run. Median and
deviation are used rather than the mean and the standard deviation because a
single odd run among the learned ones would otherwise move them, and the floor
keeps a quiet job, whose usual figure is nought, from calling a handful of
files news. A job that grows slowly moves its own median along and is not
flagged.

The note says what stood out and what is usual, such as *Files deleted: 412,
usually 0 to 6*; the usual range runs from the tenth to the ninetieth
percentile of the learned runs. It never holds the job, since the run has
already happened; only the brakes stop a run. The next run inside the usual
range closes the note by itself, and it can be acknowledged like the others.
A job's page shows its usual ranges once it is learned.

**Report unusual runs** on the **Safety net** tile switches the note off, and
switching the anomaly notes off switches it off with them. Nothing is stored
for it: the figures come from the run history.

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
~$*  .~lock.*#  *.tmp  *.temp  *.part  *.partial  *.crdownload  *.download  .pending-*
```

That is Office owner files, LibreOffice lock files, the usual half-download
suffixes and the name Android gives a file it is still writing. They exist for
seconds and mean nothing on another machine.

Android's bin stays behind as well. A file deleted in its file manager remains
in the same folder for thirty days as `.trashed-*`; synced, the bin would be
copied to the other side, and emptying it would read as a mass deletion.

`-no-default-excludes` on the command line, or `"noDefaultExcludes": true` on a
job, turns both off.

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

**Check this job**, a card on a job's page, first checks that the job can run
at all, and then compares both sides against the record and reports what it
finds: a file the record says both sides agreed on while
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
