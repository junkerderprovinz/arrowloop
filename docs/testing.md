# How it is tested

The test that matters most checks a property rather than a list of cases.
`TestConvergence` seeds two trees, applies random creates, edits, deletes and
renames to both sides for eight rounds, syncs after each, and demands the same
thing every time: both sides hold exactly the same files with the same
contents.

Around it sit the tests for the things that go wrong quietly rather than
loudly: two spellings of one name must not multiply, a newly added exclude
pattern must not delete anything, a postponed file must leave the record
untouched, a case collision must be refused rather than resolved.

```bash
go test ./...
```

## Beyond a local folder

In the tests above both sides are local folders. The engine is also exercised
against a **bucket-shaped backend**, rclone's memory
backend: no real directories, no filesystem underneath, a folder that is only a
shared key prefix, and a rename that has to become a copy and a delete. It
caught a defect the local tests could not: a job could not start at all against
a destination that did not exist yet.

The same life of a job (a first copy, a run that has to find nothing to do, an
edit, a rename, a deletion into the remote's trash) also runs through rclone's
own S3 and SFTP backends, against an S3 server and an SFTP server started inside
the test process, the second one over a real SSH connection. That does not
replace a real bucket or a real SFTP host, but it closes the part of that gap
that needs nobody else's server.

## Every guard has been broken on purpose

Removing the empty-side refusal, dropping half of the conflict resolution, switching off rename
detection, removing Unicode normalisation, filtering the sides without
filtering the record, and letting a naming collision through each produce a
failing test. A test that stays green when the thing it protects is removed is
testing something else.

## Three systems

CI runs the whole suite on Linux, Windows and macOS, because path handling,
modification-time resolution and case sensitivity all differ between them, and
every one of those differences is a way for a sync engine to be wrong. The
case-collision test can only run where the filesystem can hold both names, so
it reports itself as skipped on Windows and macOS.
