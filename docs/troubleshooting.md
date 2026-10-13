# When something goes wrong

## A failed run in your language

The interface says why a run failed in the language it shows, with its figures
written that way: a destination too full for what the run would write, a drive
that is not plugged in, a server that does not answer, a sign-in that was
refused, access that was denied, a folder that does not exist, a full quota,
a service asking for a pause, a run that was stopped, and a command before or
after the run that failed, with what it printed below. The engine records every
failure in English, so a run from an older version is said the same way. A
failure it has no words for shows the engine's own English under **The engine
reported:**, which is also what a bug report should quote. The phone's
notification about a failed run does the same in English and German, the two
languages its notifications come in.

## The run was refused and nothing happened

Read the message; each refusal names its own reason.

**"the left side lists no files at all"** means exactly that. Something is not
mounted, a path changed, or a credential expired. The engine will not treat an
empty side as a deletion, which is the point.

**"mass-delete brake"** means the run would have removed more than half of what
it knows about, and **"mass-change brake"** that it would have overwritten that
much. The job is held and listed under Anomalies, where you let the change run
or take it back. The `sync` command has nobody to ask, so it stops; run it
once with `-brake-percent 0` or `-change-percent 0` if the change is genuinely
what you wanted.

**A naming collision** means one side holds two files whose names differ only in
case, and the other side cannot tell them apart. Rename one of them.

## The destination does not exist yet

That is fine. A bucket nobody has created, or a directory nobody has made, is
treated as an empty side and the first run creates what it needs.

This does not weaken the refusal to believe an empty side. That check compares
against the record: a side that reports nothing while the record says it held
files is still refused, whether it reports nothing by listing zero objects or by
not being there at all.

## Files keep copying back and forth

Two sides that never settle usually means the two are spelling one name
differently and the engine is not folding them together. Check whether one side
is case-insensitive and the other is not; the fold is decided from what the
backends report about themselves.

If it is a small, fixed set of files, look at whether a backend can produce a
hash. Where neither side can, comparison falls back to size and modification
time, and a backend that rounds modification times will disagree with itself
forever. Raising `modWindow` is the fix.

## A file never syncs and is not reported as an error

Look at the postponed list; every run prints one. The usual reasons:

- It changed within the quiet period, so it is still being written.
- It matches an exclude pattern, including the built-in ones for half-written
  files. A file called `notes.tmp` will never travel.
- It is a symbolic link or a special file, which are reported and left alone.
- On Windows, another program is holding it open. Run as a service, or with
  administrator rights, and a plain copy is read from a shadow copy instead.

## The job has not run for days

`arrowloop jobs` shows when each one last **succeeded**. If that is old while
`arrowloop history` shows recent runs, the job is failing rather than idle, and
the history carries the error.

If neither shows anything, the schedule may simply never fire: a cron expression
is read in the container's own timezone, so check `TZ`.

## The container restarts over and over

Read the container log. The startup banner and a green "IS READY" line are
printed just before it starts listening, so a log without them died during
startup, and the last line before the end is the reason.

## The interface is empty

Confirm the API answers:

```bash
curl http://127.0.0.1:8422/api/jobs
```

If that returns jobs while the page stays blank, the binary was built without
the interface. It says so on the page rather than rendering nothing, because a
blank screen is indistinguishable from a broken one.

## Where the state lives, and what happens without it

Each job's state database is named by its own `state` field, under `/config` in
the container. Losing it is not destructive but it is disruptive: the job
forgets what the two sides agreed on and treats every file on both sides as new,
so everything that differs is copied rather than reconciled, and a deletion made
while the record was missing is propagated to nobody.

If you have to start a job over, delete its state file deliberately and run a
preview first. The preview will show you exactly what that costs before anything
moves.
