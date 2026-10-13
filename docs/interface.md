# The interface

```bash
arrowloop web -config arrowloop.json
```

serves it on `http://127.0.0.1:8422`, with the schedules running in the same
process. The container serves the same interface on port 8422, and the desktop
app shows it in a window of its own.

`arrowloop daemon` is the same scheduler without the interface, for a machine
where nobody is looking; see [the command line](cli.md#web-and-daemon).

## Finding your way

The sidebar holds five places: **Jobs**, **Conflicts**, **Anomalies**,
**Trash** and **History**. Anomalies stands beside Conflicts, since both list
what waits for an answer, and it is there for as long as the anomaly notes are
switched on (see [Anomalies](#anomalies)). A number beside an entry counts what
is there: running jobs, open conflicts, findings, files in the trash. **Sign
out** stands at the foot, above **Settings**, and only once a password is set.

**Targets** is a tile under Settings. Its switch **Also show in the sidebar**
puts the page in the sidebar as well. The tile then keeps only its first card,
with the switch, how many targets and drives are saved and **Open**, so the
page is set up in one place. An old link to `/targets` leads to the tile while
the page is not in the sidebar.

In a narrow window the sidebar becomes a bar along the bottom: **Jobs**,
**Conflicts**, **History**, **Settings** and **More**. More opens a sheet with
Anomalies, Trash and Targets.

## The first start

A new install opens on a welcome page. It says what it found, such as the
targets rclone already knows and the drives that are plugged in, and lists the
three steps to a first sync: add a target or pick a folder, create a job, run
the preview. Each step is a link and is marked done once it is. **Restore
settings** brings back every job from a backup file; **Start** goes to Jobs.

## Jobs

Every job is a card of its own, in the order of their names, with the job's
name on the card's edge. On the left the card shows the tile of the job's
direction, its two sides, the schedule and the next run. On the right the last
fourteen runs stand as a strip with the job's one status right after it, and
under them **More**, **Pause** and **Run now**. Both halves are centred on each
other, and in a narrow window the right one moves under the left. More holds everything else the job's page offers: **Edit**,
**Duplicate**, **Preview**, **Check this job**, **Find duplicates**, **Open this
job's trash** and **Remove**. Edit, Duplicate and Remove open their window on
the jobs page; Preview, Check and Find duplicates open the job's page at that
card and start it where there is only one thing to start. In the strip a green square is a run
that worked, orange one that worked but left something such as a conflict, red
one that failed, and grey a run that has not happened yet. The status is the
loudest thing that applies: **Running** with its progress, **Held**,
**Failed**, **Conflict waiting**, **Needs a look**, **Paused**, **Not run
yet**, or, when nothing waits, a green dot and the time of the last run. A
held job, a waiting conflict and a note are orange and lead to the finding or
the conflict. The counts beside **Conflicts** and **Anomalies** in the sidebar
say how much waits across all jobs.

A click anywhere else on the card opens the job's page.

**Add a job** stands at the bottom right. **More** beside it has **Run all**
and **Stop all**.

## Filter, sort and search

History has two buttons in its card, at the right end of the row where you
choose between **Files** and **Runs**. **Filter** narrows the log to one job, a
kind of entry and a span of days, and the card's heading names the choice.
**Search** opens a field in the same place and finds an entry by its path. Conflicts, Trash and Anomalies have none
of them: with a handful of jobs a card per job says enough. A link from a job's
page narrows them to that job, shown as a chip at the top, and the cross on the
chip shows every job again.

## A job's page

The head carries a back button to the jobs, the job's name, its two sides, its
schedule and next run, its status and its buttons: **Pause**, **Edit**, **More**
(Duplicate, Open this job's trash, Remove) and **Run now**. The browser's own
Back works as well.

Under it, one card for each thing to see or do: **Runs**, where a click opens a
run's details; **Files touched**, newest first (History searches across every
job); **Preview**; **Check**; **Duplicates**; **Brakes**, which shows the
global brakes locked until **Override** gives the job a value of its own, with
**Use the default** to go back; and, once the job's runs are learned, **Usual
run**, with how many files a run
usually deletes and copies and how long it takes.

## The preview

**Show what would happen**, in a job's **Preview** card, is the screen the
product exists for. It lists every proposed change with its direction and the
reason the engine gives for it. Every row starts included; take the mark off a
row to leave that change out. Nothing moves until the run button, which counts
what is included, is pressed.

The run then plans again and keeps only the paths that were included, rather
than replaying the plan that was on screen: between reading a preview and
pressing the button a file can change, and acting on the older plan would mean
acting on a stale description of the tree. An included path whose fresh action
differs from the one the preview showed is left alone.

An empty selection stays distinguishable from no selection at all, so leaving
every row out does nothing rather than running everything.

## Making and editing jobs

**Add a job** opens the form in a window, and **Edit** on a job's page does the
same for that job. **Save** is the window's main button.

A new job takes its direction, mode, schedule, quiet period and what gets
carried from the global sync settings, and the form shows each of them with the
value in force, locked, beside a lock and **Override**. **Override** gives the
job a value of its own, starting from the one it had, and the control unlocks.
**Use the default** beside an own value gives it back after asking, since the
own value is lost. A job that follows a setting changes with it; a job with its
own value keeps it. The mode comes with the direction, so the two are
overridden and given back together.

It writes the same configuration file a person can still open in an editor,
and it validates through the same function that guards it there. A refused edit
fails in the validator's own words and leaves the file exactly as it was,
because the new content is written beside it and only moved into place once it
has passed. A saved edit rebuilds the schedules and the watchers without a
restart.

The `before` and `after` commands are the exception: the interface shows them
and cannot change them. [Configuring a job](configuration.md#commands-before-and-after-a-run)
says why.

## Targets

The **Targets** tile, or the Targets page when it is pinned to the sidebar,
lists the saved targets in three cards: **Clouds**, **Object storage** and
**Servers & shares**, and the registered drives below them. **Connect storage
and clouds** and **Register a drive** float at the bottom right of the window, in the
same place as **Add a job** on Jobs.

**Connect storage and clouds** opens a window with every kind of storage rclone ships,
each under its product's name and in its group: Clouds such as Dropbox, 1Fichier
or premiumize.me, Object storage such as Azure Files, QingStor or Sia, and under
Servers & shares the protocols and the kinds that are built on another target,
such as Encrypted, Compressed, Merged targets or Alias. A product shows its
logo, from Simple Icons, Dashboard Icons or the brand's own site, and the app's
storage glyph where there is none. Picking one opens its form in the same window. Every field
has a name in plain words, and its (i) ends with the name rclone gives it, which
is what rclone's documentation and a hand-written `rclone.conf` use.

A search field stands at the top right of the window from the moment it opens.
It narrows all three groups as you type, by the name shown or by rclone's own
name, and ignores accents, so `drive` finds Google Drive and `uloz` finds
Ulož.to. Escape empties it, and a second Escape closes the window. When nothing
matches, the window says so and points to **S3 compatible** and **WebDAV**,
which most other services speak. The phone's picker has the same search above
its tiles.

Each target's row has **Test connection**. A target elsewhere is tested as soon
as the page opens, and the button shows the answer itself: green with
**Connected**, or red with **Not connected** and the reason on a line under the
name, in your language where ArrowLoop recognises the failure. Pressing it
tests again.

A password, key or token that is stored shows in the target's form as
**Saved** with a **Change** button, because the engine never sends a stored
secret back to the page. **Change** opens an empty field. The stored value
stays until you type a new one, and **Keep the saved one** goes back to it.
Saving without touching it keeps it.

## Drives

A USB disk or a share is added on the **Targets** tile with **Register a
drive**. The list offers each drive by its letter and the name the system shows
for it, and that name fills the **Name** field until you type your own.
ArrowLoop writes a small identity file onto the drive, so a job keeps finding it
after it comes back under another letter.

In a job's form, **Choose a folder** lists the drives first. A drive that is
plugged in opens like any folder, so a job can sync into one folder on it; one
that is not plugged in can only be taken whole. The job stores the drive's
identity and the folder, such as `volume:<id>/Music`, and not the letter.

A job whose drive is missing when its turn comes shows as waiting for it. When
the drive is back, the job runs within a minute if it missed a turn meanwhile,
and a job that watches for changes starts watching the drive too.

## New jobs, drafts and held jobs

A new job arrives switched on, and the form has no switch for it.

A job with **neither side** is a draft, and the file loads with it in place.
Nothing can run it: a run, scheduled or started by hand, is refused with "this
job has not been given both sides yet". A job with **one side** and not the
other is refused when it is switched on, because that is a form half filled in
rather than a draft.

Holding a job is a decision made about a job that exists, looking at the list,
so it sits on the job's row and its page, next to the control that starts a run
by hand, as **Pause** and **Resume**, and it saves itself. A held job runs
neither on its schedule nor on a change, and can still be started by hand.

The one job that arrives held is a **duplicate**, made with **Duplicate** under
**More** on a job's card or its page. It points at the same two folders as the job it was
copied from, with a state database of its own, and two such jobs on one
schedule would compare the same files against two different records. Like every
job created in the interface, it starts without `before` and `after` commands.

## Building a schedule

A schedule reads as a sentence, such as *Daily at 03:00* or *Mon, Fri at
04:15*, on a button. A click on it opens the schedule's editor beside it, on
the phone in a sheet from the bottom. The default schedule on the **Sync** tile
works the same way.

A schedule is built rather than typed. The stored value is a cron expression,
because that is what the engine reads and what a hand-edited file contains, but
the common answers are pickers: **Manual**, **Real time**, **Every N** minutes,
hours, days or weeks, **Every day** at a time, and **Weekdays** at a time. A
time is picked from a list of hours and a list of minutes in steps of five,
rather than typed into a field.

An expression the pickers cannot say opens in the **Cron** mode exactly as
written and is never rewritten, since an editor that simplified a schedule it
did not understand would destroy the thing it was opened to look at. Its
sentence then names the expression. **Cron** also writes out any other schedule
as an expression, for whoever wants to type one.

**Real time** is one of the schedules rather than a switch beside them; picking
it sets `"watch": true` and writes a backstop schedule as well.
[Watching](configuration.md#watching) explains both.

## What is running now

A running job shows its progress in its row and on its page: which file, on
which side, how far, and how fast. It arrives from the engine as it happens
rather than being polled for.

## Direction

A job's direction is an arrow, in the list and in the editor: both ways, left
to right, or right to left. A one-way job rebuilds the changes that point the
wrong way instead of dropping them, so it converges on the source rather than
drifting; see [Configuring a job](configuration.md#per-job). What it does beyond
copying is its **Mode**: **Copy only**, **Mirror** or **Move**, explained in
[Copy only, mirror or move](configuration.md#copy-only-mirror-or-move).

## Conflicts

A run that kept both versions of a file lists it under **Conflicts**, in a card
per job, across all jobs that write both ways. Each conflict says, without
opening anything:

- which file it is, with its full path;
- what went wrong, in one sentence: both sides changed the file since the last
  sync, or it turned up on both sides with different content before they were
  ever synced;
- what each side's version is: its size, when it was last changed, spelled out
  with the weekday, which of the two is newer, and the name it sits under now.
  Until somebody chooses, the newer version keeps the plain name on both sides
  and the older one sits beside it as `name.conflict-left-20261012-223200.txt`
  or `name.conflict-right-...`, after the side it came from and the run that
  set it aside.

Under that stand the three answers: **Keep both files** leaves both where they
are, **Keep the left version, trash the right** and **Keep the right version,
trash the left**. On the phone the sides go by what they are, so the answers
read **Keep the version on this phone, trash the other** or name the target.

From two conflicts up, **More** at the bottom right answers every conflict on
the page at once: **Keep both for all**, **Keep left for all** and **Keep right
for all**. It asks first and says how many conflicts the answer covers.

A choice made there is carried out by a fresh run of that job rather than by
rewriting what the first run did, so it cannot overlap another run and lands in
the history like any other. The version that loses goes to the trash, unless
the job has `noTrash`, so a wrong click can be undone from there.

## Trash

**Trash** shows every job's trash in a card per job, both sides in it, puts
files back, and deletes them for good: one file, one side, everything older
than a number of days, or all of it. **Empty the trash** is the filled button at
the bottom right, and **Delete old entries** stands beside it, with the
number of days asked in the window that confirms it; everything newer stays. Putting a file back is one
click, since it only moves the file. Removing anything for good asks first,
because the trash is the last copy there is, and emptying a side or all of it
says how many files and how big before it does.

A side whose trash cannot be read, such as a server that does not answer or a
drive that is not plugged in, says why in your language, in the same words a
failed run uses.

## History

**History** has two views, **Files** and **Runs**. A line keeps all of its
words: a long kind of entry or a long path wraps instead of being cut. A run says how many files it
copied and how many were in conflict; a click opens it with the files, and for
a conflict what was decided. The decision is the part worth having: a scheduled
run resolves a conflict by keeping both versions, because it has nobody to ask,
so the decision was made on somebody's behalf while they were not watching.

The history lists only what a run did to files. A file both sides already had
is counted as unchanged and gets no line, since on a first run over a full
folder those would be nearly every line.

A chart above the runs shows a month of them. The list answers what happened on
Tuesday; it cannot answer whether the thing is doing anything at all, which is
the question somebody has after leaving it alone for three weeks. Days with no
runs are drawn as empty columns rather than left out, because a chart that
closes its gaps turns "nothing happened" into "nothing to show".

## Anomalies

**Anomalies** lists what the engine found about a job: a run a safety brake
refused, a job that keeps failing, a schedule that is not kept, and a run far
outside what the job usually does. Tiles at the top count the findings by
severity, as tall as BombVault's, each with its name over how many are open,
and a click on one shows only that severity. **Open or closed**
switches to what was closed in the last thirty days, with how it ended.

Every finding is a card of its own, laid out as BombVault lays out its
findings, and nothing opens over the page. Every card starts at the same
height: how bad it is, the job, since when it has been seen, what happened in
one line and its answers. **Show more** opens the rest in place: the whole
sentence, the figures, the engine's words for a failure, and for a brake the
files it counted, the first ten by name and the rest as a number. **Show less**
closes it again. Its answers stand on the card: a held job offers **Run anyway**
and **Take back**, which ask first and are explained in
[A refused run holds the job](safety.md#a-refused-run-holds-the-job); a note
offers **Acknowledge** and **Run now**; an unusual run offers **Acknowledge**.
**Open job** leads to the job's page, which is also where a job gets brakes of
its own.

Below the findings, **Learning progress** shows a ring of ten parts for every
job, one part for each successful run its habits were learned from. A full
green ring means learned; see [Unusual runs](safety.md#unusual-runs). A click
on a ring opens the job.

The **Anomalies** card on the **Safety net** tile sets after how many failed
runs in a row a job counts as failing, when a scheduled job counts as overdue,
and whether a held job or a note is reported. **Overdue after** counts the days
from the scheduled run that was missed, not from the last run: a job that runs
once a week is overdue only when its weekly run is that many days late.
**Report unusual runs** switches the note about a run far outside its job's
usual range on or off.

The **Anomalies** switch on the same card turns the notes off. The page leaves
the sidebar and the phone's More sheet, no note about a failing or overdue job
is made or sent, and the notes made before stay out of sight until the switch
is on again. The brakes keep holding, since they belong to the safety net and
have limits of their own: a held job still shows **Held**, and a click on it
leads to the job's page, where the finding stands as a card with **Run anyway**
and **Take back**.

## Settings

Settings is a column of tiles beside the page: **General**, **Look**,
**Sync**, **Safety net**, **Targets**, **Security**, **Apps** and **Info**. A
tile shows all its cards, one under the other, and only the cards scroll, so
the column stays in place. In a window narrower than 1024 pixels the tiles
show their glyphs alone. Below 768 pixels, and on a phone's browser, they move
into a strip above the cards, so the cards get the whole width: the open tile
shows its name, the others their glyph, with the name on hover. Settings opens on the tile used last, and every tile
has an address of its own, such as `/settings/sync`. An older address such as
`/settings/workload` leads to the tile that holds its cards.

You can put the tiles in your own order. Hold a tile, or drag it with the
mouse, and move it along the column; the column wiggles while a tile is
carried, and Escape puts it back. With the keyboard, Alt and an arrow key move
the tile that has the focus, in the column and in the strip. The strip shows
the same order. The browser keeps the order, and **Reset** in the **Tile order**
row on **Look** brings back the original one.

- **General**: the settings backup and the workload (bandwidth limit, jobs at
  once and the run log file), and in the desktop app this computer: the
  window, starting with the system and automatic updates.
- **Look**: language, design (Dark, Light or System), corners, motion, the
  tile order, labels and colours.
- **Sync**: the global sync settings every job starts from, transfer,
  contents, **Exceptions**, retries and the shared exclude lists.
  **Exceptions** lists only the jobs with a value of their own, each with those
  values and **Use the default**, and is not there while every job follows the
  defaults. **Safety net** has the same card for jobs with brakes of their own.
- **Safety net**: the two brakes, the anomaly notes with their switch, and the
  notifications: when they go out, then a webhook (generic, Discord, Slack,
  Gotify or ntfy), Matrix, email, Apprise and Healthchecks.io, each with its
  switch and **Send a test**. A saved secret shows as **Saved** with
  **Change** beside it; see [Notifications](configuration.md#notifications).
- **Targets**: the storage targets and drives; see [Drives](#drives).
- **Security**: password, two-factor authentication and passkeys. The desktop
  app has no such tile, since nobody else reaches its window.
- **Apps**: the other ways to run ArrowLoop, each with its version, and the
  phone app from Google Play, F-Droid or as an APK.

The settings have a search. It stays out of sight until you scroll up once more
at the top of a page, or press `/` or Ctrl+K. It finds a setting by its name or
by a word from its explanation, and it knows the old names too: **Engine**
leads to the tiles that took its cards, **App** to Apps, and a card's old title
such as **What gets carried** to the card that carries it now.

## Info

The last tile has three cards. **Version** lists ArrowLoop, GlimStone and
rclone, each linked to its release notes, and **Check for updates** asks GitHub
for a newer release. After an update **New** stands beside it and opens the
list of changes (see below). **Help** leads to GitHub, to email and to this
manual, and **Bug report** downloads one file with the versions, the settings
and jobs without passwords or keys, the last 100 runs and the open anomalies.
Nothing is sent: you attach the file to an issue yourself. Then comes
**About**.

## What's new

After an update a glowing green dot marks each change on its page, and a dot
on a link says something behind it changed. A click on a dot hides it, and a
link's dot goes once everything behind it has been seen. **New** in the
Version card on the Info tile shows how many changes you have not seen yet and
opens a window listing the changes of the last update, each with a way to it.
**Mark all as seen** at its top hides every dot. Once nothing is left, the same
button reads **Show all again** and brings them back.

## The look

The interface uses [GlimStone](https://github.com/junkerderprovinz/glimstone)
3.4.2, with its reference tokens and appearance engine copied in verbatim rather
than reimplemented. Design, corner shape and accent are the viewer's to set on
the **Look** tile.

The accent marks activity and the one action a page is for, such as **Add a
job**. Every other button is grey.

## On the phone

The Android app shows the same places. Its bar holds **Jobs**, **Conflicts**,
**History**, **Settings** and **More**, which opens Anomalies, Trash and
Targets; Anomalies goes from there while its notes are switched off. Every job
card shows the same single status as on the web, and its **More** menu holds
Open, Edit, Duplicate, Preview, Check this job, the trash of either side and
Delete. **Empty the trash** is the
floating button on the Trash screen. The Conflicts screen shows every conflict
as on the web, and from two conflicts up answers all of them at once from the
card at its foot, after asking. The Anomalies screen shows every finding as a
card with its answers, two lines high until **Show more** opens the rest, and
the learning rings below them. A job's own brakes
and what its runs usually do are on the job's screen. A More menu that would
hold a single action is that action's button instead.

Settings on the phone is one column of cards: Language, This phone (file
access, notifications, background activity, lock), Appearance, Motion, Sync
engine, Settings backup, On a server, Desktop app, Problems?,
About this app and Danger zone.

## Who can reach it

`arrowloop web` listens on loopback unless `-addr` or `ARROWLOOP_ADDR` says
otherwise, and the container listens on every address. This interface starts
jobs that delete files, so anybody on the network who can reach it can drive
it. A password, a second factor and passkeys are set on the **Security** tile;
[Installing](installing.md#a-password-for-the-interface) has the details.

Over plain HTTP the session cookie crosses the wire in clear, so a machine
reachable from outside wants TLS in front of it, with a password or without.
