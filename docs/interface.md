# The interface

```bash
arrowloop web -config arrowloop.json
```

serves it on `http://127.0.0.1:8422`, with the schedules running in the same
process. The container serves the same interface on port 8422, and the desktop
app shows it in a window of its own. It has a tab each for Jobs, Targets,
History, Conflicts, Trash and Settings.

`arrowloop daemon` is the same scheduler without the interface, for a machine
where nobody is looking; see [the command line](cli.md#web-and-daemon).

## The preview

**Preview**, in a job's **Options** menu, is the screen the product exists for.
It lists every proposed change with its direction and the reason the engine
gives for it. Each row can be unticked, and nothing moves until the button is
pressed.

The run then plans again and keeps only the paths that were ticked, rather than
replaying the plan that was on screen: between reading a preview and pressing
the button a file can change, and acting on the older plan would mean acting on
a stale description of the tree. A ticked path whose fresh action differs from
the one the preview showed is left alone.

An empty selection stays distinguishable from no selection at all, so unticking
every row does nothing rather than running everything.

## Making and editing jobs

Jobs are made and edited on the same tab they are watched on. **Add a job**,
the plus button at the corner of the window, adds one and opens its form;
**Edit**, in a job's **Options** menu, opens that job's. The form opens inside
the job's own card.

It writes the same configuration file a person can still open in an editor,
and it validates through the same function that guards it there. A refused edit
fails in the validator's own words and leaves the file exactly as it was,
because the new content is written beside it and only moved into place once it
has passed. A saved edit rebuilds the schedules and the watchers without a
restart.

The `before` and `after` commands are the exception: the interface shows them
and cannot change them. [Configuring a job](configuration.md#commands-before-and-after-a-run)
says why.

## New jobs, drafts and held jobs

A new job arrives switched on, and the form has no switch for it.

A job with **neither side** is a draft, and the file loads with it in place.
Nothing can run it: a run, scheduled or started by hand, is refused with "this
job has not been given both sides yet". A job with **one side** and not the
other is refused when it is switched on, because that is a form half filled in
rather than a draft.

Holding a job is a decision made about a job that exists, looking at the list,
so it lives on the card next to the control that starts a run by hand, as
**Pause** and **Resume**, and it saves itself. A held job runs neither on its
schedule nor on a change, and can still be started by hand.

The one job that arrives held is a **duplicate**, made with **Duplicate** in the
**Options** menu. It points at the same two folders as the job it was copied
from, with a state database of its own, and two such jobs on one schedule would
compare the same files against two different records. Like every job created
in the interface, it starts without `before` and `after` commands.

## Building a schedule

A schedule is built rather than typed. The stored value is a cron expression,
because that is what the engine reads and what a hand-edited file contains, but
the common answers are pickers: **Manual**, **Real time**, **Every N** minutes,
hours, days or weeks, **Every day** at a time, and **Weekdays** at a time. A
time is picked from a list of hours and a list of minutes in steps of five,
rather than typed into a field.

An expression the pickers cannot say opens in the **Cron** mode exactly as
written and is never rewritten, since an editor that simplified a schedule it
did not understand would destroy the thing it was opened to look at.

**Real time** is one of the schedules rather than a switch beside them; picking
it sets `"watch": true` and writes a backstop schedule as well.
[Watching](configuration.md#watching) explains both.

## What is running now

A running job shows its progress in its own card on the Jobs tab: which file,
on which side, how far, and how fast. It arrives from the engine as it happens
rather than being polled for.

## Direction

A job's direction is an arrow, in the list and in the editor: both ways, left
to right, or right to left. A one-way job rebuilds the changes that point the
wrong way instead of dropping them, so it converges on the source rather than
drifting; see [Configuring a job](configuration.md#per-job). What it does beyond
copying is its **Mode**: **Copy only**, **Mirror** or **Move**, explained in
[Copy only, mirror or move](configuration.md#copy-only-mirror-or-move).

## The look

The interface uses [GlimStone](https://github.com/junkerderprovinz/glimstone)
3.0.2, with its reference tokens and appearance engine copied in verbatim rather
than reimplemented. Theme, corner shape and accent are the viewer's to set,
under **Settings**, **Look**.

The accent marks activity and nothing else, which is why the switches down the
preview are colourless: every row arrives ticked, and a control that is on in
all of them is not activity.

## Who can reach it

`arrowloop web` listens on loopback unless `-addr` or `ARROWLOOP_ADDR` says
otherwise, and the container listens on every address. This interface starts
jobs that delete files, so anybody on the network who can reach it can drive
it. A password, a second factor and
passkeys are set under **Settings**, **Security**;
[Installing](installing.md#a-password-for-the-interface) has the details.

Over plain HTTP the session cookie crosses the wire in clear, so a machine
reachable from outside wants TLS in front of it, with a password or without.

## History

A row in the History tab says how many files a run copied and how many were in
conflict; clicking it says which files, and for a conflict what was decided.
The decision is the part worth having: a scheduled run resolves a conflict by
keeping both versions, because it has nobody to ask, so the decision was made
on somebody's behalf while they were not watching.

The history lists only what a run did to files. A file both sides already had
is counted as unchanged and gets no line, since on a first run over a full
folder those would be nearly every line.

## A month of runs

A chart above the history list shows a month of runs. The list answers what happened
on Tuesday; it cannot answer whether the thing is doing anything at all, which
is the question somebody has after leaving it alone for three weeks. Days with
no runs are drawn as empty columns rather than left out, because a chart that
closes its gaps turns "nothing happened" into "nothing to show".

## Conflicts

A run that kept both versions of a file links to **Conflicts**, a tab of its own
that lists every conflict still open across all jobs that write both ways. Each
row offers **Keep both**, **Keep left** and **Keep right**.

A choice made there is carried out by a fresh run of that job rather than by
rewriting what the first run did, so it cannot overlap another run and lands in
the history like any other. The version that loses goes to the trash, unless
the job has `noTrash`, so a wrong click can be undone from there.

## Trash

Trash has a tab of its own too. It shows every job's trash on both sides, puts
files back, and deletes them for good: one file, one side, everything older
than a number of days, or all of it. Putting a file back is one click, since it
only moves the file. Removing anything for good asks first, because the trash
is the last copy there is, and emptying a side or all of it says how many files
and how big before it does.
