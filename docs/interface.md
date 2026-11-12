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

The sidebar holds six places: **Overview**, **Jobs**, **Conflicts**,
**Anomalies**, **Trash** and **History**. Anomalies stands beside Conflicts, since both list
what waits for an answer, and it is there for as long as the anomaly notes are
switched on (see [Anomalies](#anomalies)). A number beside an entry counts what
is there: running jobs, open conflicts, findings, files in the trash. **Sign
out** stands at the foot, above **Settings**, and only once a password is set.

**Targets** is a tile under Settings. Its switch **Also show in the sidebar**
puts the page in the sidebar as well. The tile then keeps only its first card,
with the switch, how many targets and drives are saved and **Open**, so the
page is set up in one place. An old link to `/targets` leads to the tile while
the page is not in the sidebar.

**Instances** is switched on in the **Sidebar** card on **Look**, as in
BombVault, and then stands in the sidebar after Targets. Until then its cards
follow the others on the **Pairing** tile, and `/instances` leads there. It is
hidden at first.

The **Sidebar** card on the **Look** tile holds all three switches in one
place: Overview, Targets and Instances. The Overview is shown at first and
ArrowLoop opens on it. Switched off, it leaves the sidebar, ArrowLoop opens on
Jobs and `/dashboard` leads there too. The browser keeps the switches.

In a narrow window the sidebar becomes a bar along the bottom with four places
and **More**: **Overview**, **Jobs**, **Conflicts** and **History**, or **Jobs**,
**Conflicts**, **History** and **Settings** while the Overview is switched off.
More opens a sheet with Anomalies, Trash and Targets, Instances once it is
pinned, and Settings whenever the Overview has its place on the bar.

## The Overview

`/dashboard` shows how everything stands at a glance. At the top one sentence
sums it up beside the ArrowLoop mark in its colour: **All is well**, **All is
well, with a few notes** while a finding only notes something, **Running now**
while a job runs, or **Waiting for you** with a count when a last run failed, a
conflict waits or a finding holds a job. A warning always wins over a run in
progress. Under it stand the time of the last run and of the next one.

**In numbers** counts the running, paused and failed jobs, the open conflicts
and findings and what lies in the trash, and each number opens the page that
lists it. **Jobs** lists every job in your own order with its status, its last
and next run and **Run now**, and a click on a line opens the job. **Last
runs** shows the five newest runs with what they moved, and **Every run** opens
History. Once instances are paired, each one follows with its jobs, as on the
Instances page. In the corner, **Run all** starts every job that is ready, or
**Stop all runs** while something runs. Without a job yet, the page says how
to start and **Add a job** opens the editor right there.

## The first start

A new install opens on a welcome page. It says what it found, such as the
targets rclone already knows and the drives that are plugged in, and lists the
three steps to a first sync: add a target or pick a folder, create a job, run
the preview. Each step is a link and is marked done once it is. **Restore
settings** brings back every job from a backup file; **Start** goes to Jobs.

## Jobs

Every job is a card of its own, with the job's name on the card's edge. The
jobs stand in the order of their names until you move one. Drag a job by the
handle at its left, and the others make room while it is carried. On a touch
screen, hold the handle first. Alt and an arrow key move the job that has the
focus. The first move keeps that order in the configuration file, a new job
goes to the end, and History, Trash and Conflicts offer the jobs in the same
order in their Job filter.

**Cards** and **Compact** under **Job list** on the **Look** tile switch the
view, and each browser keeps its choice. Compact shows a job on one row: its colour, its
name, its status, its last run, **More** and **Run now**, with **Pause** moved
into More. A click on the row opens the job, and the handle moves it as on the
cards. On the left the card shows the tile of the job's
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

## Sort, filter and search

History, Trash, Conflicts, Anomalies and a job's **Files touched** keep these
in the list itself, with no buttons over it. A click on a heading sorts by that
column, and a second click turns the order round. History and Files touched
stay newest first, since the engine hands out their log a screenful at a time.
The ▾ beside a heading filters by that column, in a window under the heading
over the dimmed page; its choices stand side by side where they fit and under
each other where not. A filter that narrows the list marks its ▾ and shows
above the list, in History at the end of the row with **Files** and **Runs**
and elsewhere under the tiles on top, with **Show everything** to undo it. Typing while the list has the focus, or Ctrl+F, opens
a search that floats over the top of the list and finds an entry by its path;
Escape empties and closes it. In History and a job's **Files touched** the
columns can be moved and widened: drag a heading to another place, and the
columns make room while it is carried, or drag the line at any column's edge,
which shows while the pointer is over the headings; a double click on that
line gives the column its width back. Every line keeps to its columns on one
line, cut at the end, with the whole path in its bubble. Alt with an arrow
key moves the focused heading. Each list keeps its own arrangement in the
browser. A device with only a touch screen has no key to
type with, so a magnifier at the end of the headings opens the search there. A
line under the headings says all this while the pointer is over them, and by
itself on the first visit. On a touch screen a long press on the headings
shows it.

A link from a job's page narrows Trash, Conflicts and Anomalies to that job,
shown as a chip at the top, and the cross on the chip shows every job again.

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
same for that job. **Save** is the window's main button. Each field stands at
the end of its row with its name at the start, and in a narrow window it moves
under the name. The exclude list keeps its name above it.

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
tests again. Once connected, a target that reports its size shows how full it
is as a bar under its name.

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

Under that stand the three answers in the order of the sides: **Keep the left
version, trash the right**, then **Keep both files**, which leaves both where
they are, and **Keep the right version, trash the left**. On the phone the sides go by what they are, so the answers
read **Keep the version on this phone, trash the other** or name the target.

From two conflicts up, **More** at the bottom right answers every conflict
shown at once: **Keep left for all**, **Keep both for all** and **Keep right
for all**. It asks first and says how many conflicts the answer covers. Four
tiles above the conflicts count how many wait, as the Anomalies tiles do: all
of them, those changed on both sides, those new on both sides, and the rest.
A tile shows its kind alone, the ▾ at the **Job** heading narrows the list to
one job, and the answers for all cover what is shown. A kind with nothing
waiting keeps its tile at 0.

A choice made there is carried out by a fresh run of that job rather than by
rewriting what the first run did, so it cannot overlap another run and lands in
the history like any other. The version that loses goes to the trash, unless
the job has `noTrash`, so a wrong click can be undone from there.

A job with **Let the newer version win a conflict** switched on never asks. It
keeps the version saved last, as if somebody had picked it here, and the other
goes to the trash. That goes by the modification times both sides report, so a
side whose clock runs wrong wins or loses for that reason. Two versions saved
within a couple of seconds of each other still keep both.

## Trash

**Trash** counts what the trash holds in three tiles on top, as the Anomalies
tiles do: all of it, the left side and the right side, each with its size. A
tile shows its side alone, the ▾ at the **Job** heading narrows the list to
one job, and the two buttons at the bottom right act on what is shown. Below
them every
job's trash stands in a card per job, both sides in it, sorted by path, size or age
from the headings. It puts files back, and deletes them for good: one file, one side, everything older
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

**History** has three views, **Files**, **Runs** and, while Anomalies is on,
**Findings**: what was closed in the last thirty days, each as its card with
how it ended, filtered by severity and job from the headings. A line keeps all of its
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
and a click on one shows only that severity. The page shows what is open; what
was closed in the last thirty days is in History, and **Closed ones in
History** at the foot of the list leads there. The headings sort the findings
by severity, job or when they were first seen.

Every finding is a card of its own, laid out as BombVault lays out its
findings, and nothing opens over the page. Its badge says how bad it is; the
card has no coloured edge. Every card starts at the same
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
**Sync**, **Safety net**, **Targets**, **Security**, **Pairing**, **Apps** and
**Info**. A
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

- **General**: the settings backup, with Export and Import side by side and
  in its (i) what they cover and that Import also takes a FolderSync export
  or a luckyBackup profile ([Configuration](configuration.md#moving-over-from-foldersync-or-luckybackup)).
  Then the workload (bandwidth limit, jobs at once and the run log file), and
  in the desktop app this computer: the window and starting with the system.
- **Look**: language, design (Dark, Light or System) with the **OLED** switch,
  corners, motion, the job list (Cards or Compact), the tile order, labels and
  colours.
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
- **Pairing**: the twelve words that pair this instance with your others, who
  is in the group, and the relay; see [Pairing](#pairing).
- **Apps**: the other ways to run ArrowLoop, each with its version, and the
  phone app from Google Play, F-Droid or as an APK.

The settings have a search. It stays out of sight until you scroll up once more
at the top of a page, or press `/` or Ctrl+K. It finds a setting by its name or
by a word from its explanation, and it knows the old names too: **Engine**
leads to the tiles that took its cards, **App** to Apps, and a card's old title
such as **What gets carried** to the card that carries it now.

## Pairing

Pairing puts your ArrowLoop instances in one group, as BombVault and
KnightLoader do: a server, the desktop app and the phone app alike. Once two
instances approved each other, **Instances** on each one shows the jobs of the
others, a card per instance with their last runs and their status, and **Run
now** or **Cancel the run** works on them from there. Instances stands at the
end of the Pairing tile, or in the sidebar once it is switched on in the
**Sidebar** card on **Look**.

A job's name on such a card opens its page, marked **On** and the name of the
instance it belongs to. **Edit** opens the usual editor for its sides,
schedule, mode, exclusions and the other settings, and **Pause** holds it.
**Browse targets** walks the folders of that instance and opens its targets by
name. **Save** sends the job to its instance, which checks it by its own rules,
just as a save there would, and a refusal shows in the editor. From another
instance a side can be one of that instance's targets by its name, one of its
marked drives, or a folder at or below one its jobs already use. A network
share by its address and the folders that hold ArrowLoop's and the targets'
settings are refused. The picker offers exactly these places. The state
database, the trash switch, the brakes and the commands before and after a run
stay as that instance has them, and a job with such commands keeps its name
and its sides. Each save, and
each run started or stopped from here, is written to that instance's log with
the name and id of the instance it came from. Adding or removing a job, its
files, preview and checks, the targets themselves, the settings and the trash
stay with each instance. An instance on an older version can still run and
stop its jobs from here, and the page says to update it to edit them. The phone
app starts and stops the jobs of the other instances, and leaves editing them
to the web interface.

The tile is built as BombVault's and KnightLoader's: three numbered cards whose
pictures play the steps below, then **Phrase**, **Instances** with who is in
the group and where this instance stands, **This instance** with its name and
key, and **Relay**.

1. On the first instance, open **Settings**, **Pairing** and choose **Make a
   phrase**. A window shows twelve words, with a QR code beside them.
2. On every other instance, choose **Enter phrase** and paste the words into
   the window that opens. A
   word that is not on the list is named with its place before anything is
   sent. On the phone the same screen is under Settings, Pairing; scan the QR
   code with the phone's camera and paste the words there.
3. Each instance then lists the other under **Waiting for approval**, with the
   start of its key. Compare it with the key the other instance shows as
   **This instance's key**, and choose **Approve** on both. Your decision is
   passed on to every other instance of the group.

**Show phrase** shows the words again, and asks for the password where one is
set. **Remove** takes an instance out of the group on every instance: its key
stops working for good, and it forgets the words. Entering them there again
makes it a new instance that waits for approval. **Leave group** does the same
from the instance itself. The name the others see is set under **Name in the
group** on **This instance**, saved as you type, and it is the computer's name
until you give one.

Instances on one network call each other directly and need no relay for
that. A container or a server that listens on the network announces itself on
the multicast address `239.255.77.50`, port 8752, and where multicast does not
reach, as from a container on a Docker bridge, it tries the other addresses of
its own network on its port and on 8422. It goes by the address you open its
interface at. The phone and the desktop app take no calls from the network,
but they call the others directly once they know where they are. A call goes
directly first and over the relay only when that fails, never both ways at
once.

Everywhere else the instances reach each other through a relay. **Project relay** is
ParleyPort, which the project runs at `parleyport.halleluja.design`, free of
charge. **Own relay** takes the address of one you run yourself, from the
Unraid Community Apps or with Docker. **ArrowLoop instance** makes one of your
instances the relay: switch on **Serve as relay** on the one that is reachable
from outside, and it answers the others of your group at `/relay/connect` on
its own address, behind the same reverse proxy and certificate. Enter that
address on every instance, the one that serves included. The phone and the
desktop app are reached by nobody, so they use such a relay but never serve
one. **No relay** keeps the instance to itself. Each route says what it needs beside a picture of a message on its
way, and **What the relay sees** opens the rest. While the relay cannot be
reached, the card lists what to check. Every call between your instances is
sealed with a key made from the
twelve words and signed with a key each instance makes for itself, so the
relay cannot read or change any of it. It sees which instance a message is
for, how big it is, when it arrives and the IP addresses of your instances.
The words themselves never leave an instance.

### The fortress

A fortress is all the apps of one household that share a phrase: ArrowLoop,
BombVault, KnightLoader and the others. **Enter phrase** on the Pairing tile,
on the web or on the phone, joins ArrowLoop with that phrase, and from then on
the fortress's phrase is also the phrase of the pairing. The instances ArrowLoop
was paired with come along with their approvals. One that is away gets the
phrase once it is back, and the old pairing stays open for it for 30 days.
After that the old pairing closes, and the tile names every instance that never
came, so you can bring it in with the phrase or remove it.

**Show the other apps of the fortress**, under your instances, shows a card for
every other app with its instances, and the permissions. A permission is one
thing another app may do here: see the jobs, start a job, see the targets for
new jobs, add a job, fetch a backup or put a backup back. Each has its own
switch, and all are on except putting a backup back, which waits until you
switch it on. A backup is the settings file and a copy of each job's state
database. Before one is put back, ArrowLoop keeps what it had as
`before-import.tar` beside its settings, and no job runs while it goes back.

**Show phrase** asks for the password and shows the twelve words with a QR
code. **Change phrase** moves every app it can reach to new words and names the
ones still on the old phrase, so a removed device stays out. **Leave fortress**
takes ArrowLoop out of the fortress and out of the pairing with it.

## Info

The last tile has three cards. **Version** lists ArrowLoop, GlimStone and
rclone, each linked to its release notes, with **Update automatically** right
under ArrowLoop in the desktop app and in a container, where it asks GitHub
once a day and names a newer release under ArrowLoop. Under them stand **New**
and **Check for updates**, which wears the sync symbol and asks GitHub for a
newer release. **New** opens the window
with the release notes and the changes (see below); while it lists no change it
reads **Release notes** and opens the same window. **Help** leads to GitHub, to email and to this
manual, and **Bug report** downloads one file with the versions, the settings
and jobs without passwords or keys, the last 100 runs and the open anomalies.
Nothing is sent: you attach the file to an issue yourself. Then comes
**About**.

## What's new

After an update a glowing green dot marks each change that came with a
release newer than the one you had open before. It sits on the change's page,
and a dot on a link says something behind it changed. A click on a dot hides it, and a link's dot goes once
everything behind it has been seen. What you had already seen of older
releases stays seen. **New** in the Version card on the Info tile shows how
many changes you have not seen yet. A browser that never had an older version
open starts with every change seen.

The window it opens is called **New since** the release you had before. It
holds one card per release since then, newest first: the number on its badge,
its release notes, and its changes grouped by page. A change no page shows,
such as one in the phone app, stands first under **In the background** and
counts as seen once the window closes. An older release keeps its card while
one of its changes is unseen, and the running release always has one. **Go
there** leads to a change's page. **Mark all as seen** at the top hides every
dot. Once nothing is left, the same button reads **Show all again** and brings
them back. **All releases** at the foot of the window opens the notes on
GitHub. After an update the window opens by itself, in a browser that had the
version before open.

## The look

The interface uses [GlimStone](https://github.com/junkerderprovinz/glimstone)
4.2.8, with its reference tokens and appearance engine copied in verbatim rather
than reimplemented. Design, corner shape and accent are the viewer's to set on
the **Look** tile.

The accent marks activity and the one action a page is for, such as **Add a
job**. Every other button is grey.

**OLED** under Design puts the dark look on true black for OLED and AMOLED
screens. It counts whenever the dark look shows, also when Design follows the
system, and keeps its state while the light look shows, where its row steps
back. The browser keeps the switch, never the engine's settings, since the
same interface may open on an LCD screen elsewhere.

Where the system has an accent colour of its own, a swatch with a wand stands
first in the accent row and takes it: the accent of Windows, macOS or Linux
(through the settings portal) in the desktop app, and the system colour in
Firefox and Safari. Chrome and the browsers built on it report a fixed colour
instead, so there is no such swatch there. The choice is kept as the word
`system`, so each device paints its own colour, and the colour is read again
when the window comes back to the front.

## On the phone

The Android app shows the same places. Its bar holds **Overview**, **Jobs**,
**Conflicts**, **History** and **More**, which opens Anomalies, Trash, Targets
and Settings; Anomalies goes from there while its notes are switched off. The
Overview opens with the same sentence as on the web and lists the paired
instances at its end. **Overview on the bar** under Appearance in Settings
takes it off the bar: the app then opens on Jobs, and Settings moves from More
to the fourth place. Every job
card shows the same single status as on the web, and its **More** menu holds
Open, Edit, Duplicate, Preview, Check this job, the trash of either side and
Delete. A long press lifts a job and the finger carries it to its new place,
in the order the web shows as well. TalkBack offers Move up and Move down
instead. **Cards** and **Compact** under Job list in Settings, Appearance
switch the view, and the phone keeps its choice. **Empty the trash** is the
floating button on the Trash screen. The Conflicts screen shows every conflict
as on the web, and from two conflicts up answers all of them at once from the
card at its foot, after asking. The Anomalies screen shows every finding as a
card with its answers, two lines high until **Show more** opens the rest, and
the learning rings below them. History sorts and filters from the headings of
its list: a tap on a heading sorts, its ▾ opens the filter, and the magnifier at
the end of the row opens the search, since a phone has no keys to type into a
list. A long press on the headings shows the line that explains them. A job's own brakes
and what its runs usually do are on the job's screen. A More menu that would
hold a single action is that action's button instead.

Settings on the phone is one column of cards: Language, This phone (file
access, notifications, background activity, lock), Appearance, Motion, Sync
engine, Pairing, Settings backup, On a server, Desktop app, Problems?,
About this app and Danger zone. Pairing opens the same cards as on the web,
and **Instances under More**, under Appearance, adds Instances to the More
sheet. Until then its cards follow on the Pairing screen. Appearance has the **Overview on the bar** switch and the **OLED** switch under
Design, and from Android 12 on the accent row starts with the wand swatch,
which takes Material You's colour from the wallpaper.

## Who can reach it

`arrowloop web` listens on loopback unless `-addr` or `ARROWLOOP_ADDR` says
otherwise, and the container listens on every address. This interface starts
jobs that delete files, so anybody on the network who can reach it can drive
it. A password, a second factor and passkeys are set on the **Security** tile;
[Installing](installing.md#a-password-for-the-interface) has the details.

Over plain HTTP the session cookie crosses the wire in clear, so a machine
reachable from outside wants TLS in front of it, with a password or without.

A paired instance reaches this one directly at `/api/group/call` or through
the relay, and only for the job list, **Run now** and **Cancel the run**, opening and saving a job, and the
folders and target names its sides are picked from. Every other route answers
the group with 404. The direct route needs no session, like the relay socket:
a call there carries a tag made from the twelve words and is refused before
its body is read when the tag is wrong, and inside it is sealed and signed as
over the relay. An instance that serves the relay
opens `/relay/connect` for it and nothing else: it lets in only the key of its
own group, drops everybody on it when the switch goes off or it leaves the
group, and answers 404 there while it does not serve. It has to be approved here first,
and it never sees the settings, the targets, the trash or the twelve words.
Without a password anybody who opens this interface can read the words, which
the Pairing tile says.
