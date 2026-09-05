# Safety

A two-way sync can destroy data, and the most common way is not a bug in the
code. It is a correctly executed deletion that nobody wanted.

## Nothing is deleted outright

A deletion is a move into `.reeveroll/trash/<run>/` on the side that loses the
file. The trash sits inside the tree but under a prefix the scanner skips, so it
never travels to the other side.

## The mass-delete brake

A run that would delete more than half the known files stops and says so, naming
the first paths it would have touched. Below ten deletions it never fires,
because deleting three of four files is proportionate and almost certainly what
you meant.

## An empty side is never believed

If a side lists no files at all while the record says it used to hold some, the
run is refused.

!!! danger "This is the classic total loss, and it is not a bug"
    A disk fails to mount. The side lists nothing. The engine reads that
    correctly as "everything was deleted" and correctly deletes it on the other
    side. Nothing malfunctioned. The only defence is to refuse to believe an
    empty side.

The two brakes cover different ground and both are needed. The percentage brake
does nothing for a job with five files in it, because five deletions is below
its floor; that case is caught only by the refusal above.

## Half-written files

A file is left alone until it has sat unchanged for the quiet period. This is
not about latency: a run started while somebody is saving a large document
copies whatever is on disk at that instant, and the copy is garbage. A schedule
is no defence, since a run every two minutes lands mid-write just as readily as
a filesystem watch does.

On Windows, a file another program holds exclusively is skipped with that as the
reason. That is Windows-only by nature: its locking is mandatory and really does
make a file unreadable, while POSIX locks are advisory and do not stop a reader.

The names programs use while still writing never travel at all: Office owner
files, LibreOffice lock files, and the usual half-download suffixes.

## Excluding never deletes

A path that stops being visible has **not** been deleted. The exclusion is
applied to the stored record as well as to both sides, so adding a pattern hides
files rather than removing them.

## A record is only written when both sides really agree

After every action the engine re-reads the path on both sides and compares.
Writing a record for a pair that does not match is how a sync tool stops
noticing a difference: the next run compares both sides against a record that
already matches them both, concludes nothing changed, and the divergence becomes
permanent and invisible. That specific failure stops the run.

## One file failing does not stop the run

A transfer that fails is reported as postponed and the next file is attempted.
That is safe precisely because the record is only written after success: a file
that could not be copied keeps its old record, or none, so the next run tries
again. Postponing is not agreeing.

## A crash is survivable at every step

Records are written per file as it settles, never in one batch at the end, so an
interrupted run leaves a record that is smaller than reality but never wrong.
Resolving a conflict takes three filesystem operations, and there is a test that
kills the run after each of them and demands that a single following run
recovers without losing either version.
