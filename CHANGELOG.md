# Changelog

Every release is written by hand. There is no generated list of commit subjects
here, because that is a record of what was typed rather than of what changed for
the person reading it.

The full notes for each release are in
[`.github/release-notes/`](.github/release-notes/) and on the
[releases page](https://github.com/junkerderprovinz/arrowloop/releases).

## v0.5.0

Forty-six reported points, and the largest finding was that the program could already do more than it showed.

## ✨ Added

- **An Engine tab, for the settings that were always read and never settable.** The bandwidth limit, how many jobs may run at once, where the run log lives, who gets told when a run finishes, and both brakes. Every one of these was being read by the engine and could only be set by editing the configuration file, which from the outside is the same as not existing. The brakes are the point: they are the net that stops a run removing more than half of everything it knows about, and they could not be seen at all.
- **Shared defaults, so the job form can stay short.** What is usually the same for every job lives in one place and a job keeps only what makes it different. Empty folders and metadata became three-state settings in the process, because a plain switch cannot tell "off" from "not mentioned", and a default would have turned a deliberate "off" back on without a word.
- **Named exclude lists.** Written once and asked for by name, instead of the same twenty lines pasted into every job and drifting apart. A job asking for a list that does not exist is refused when the file is read: a filter that silently matches nothing does not break anything, it just quietly syncs the thing you asked it to leave alone.
- **The history opens.** A row said twelve copied and two conflicts; clicking it now says which files, and for a conflict what was decided. That last part is the one worth having: a scheduled run keeps both versions because it has nobody to ask, so the decision was made on your behalf while you were not watching. It can be revisited from there, which starts a fresh run for exactly those paths rather than rewriting what the first run did.
- **A month of runs, drawn above the list.** Days with no runs are empty columns rather than missing, because a chart that closes its gaps turns "nothing happened" into "nothing to show".
- **Room is checked before an automatic run starts.** A full destination is worse than a failed run: the transfer stops midway, the tree holds a partial file, and the record and the disk disagree in a way only a full re-scan resolves. A run started by hand is never refused, and only the space finding stops one: a side that does not exist yet is created by the very run being refused.
- **A health check and a consistency check, on a button.** The first asks whether the job can work at all. The second compares both sides against the record and reports where they disagree, marking each finding with whether any future run would notice it by itself. That is the failure a sync tool cannot see: if a row claims the two sides agree when they do not, every later run compares both against a record that matches both.
- **The first run can be told which side is right.** With no record yet, every file on both sides counts as new, so the default merges them and the other side fills with files you meant to leave behind. Choosing a side makes it win every disagreement while a file it never had is left exactly where it is: seeding copies, it does not mirror. It applies once.
- **The bin can be looked in.** Nothing was ever deleted outright, and that was only half a promise while the only way to look was a file manager. It lists, one entry goes back, and old runs clear out by age. An entry whose age cannot be read says so and is never cleared by age.
- **A file that is overwritten can keep its history.** The last few contents of an edited file, off by default, filed under the same reserved directory the bin uses.
- **A schedule that only reports.** The whole comparison runs on time, writes down what it would have done per file, notifies, and touches nothing. Pressing the button by hand still writes.
- **An optional password.** Off by default and unchanged for every install that does not set one. The hash comes from the environment and deliberately not from the configuration file, which is served whole as a backup and can be replaced whole by a restore.
- **Start and hold on a job's card, and the jobs in the tray menu.** Two verbs and never one button: a held job that could no longer be started by hand would be a deleted job with extra steps.
- **Real time in the schedule, where you look for it.** It is an addition to the schedule rather than one of its modes, because a watcher that missed an event has no way to know it did, and the schedule is what eventually notices.
- **Not on battery and not on a metered connection.** Conditions only the desktop can ask about, so the container is unaffected. An unknown power state counts as mains: a desktop PC with no battery reports unknown on some hardware.
- **Duplicate a job, and keep a copy of the whole setup.** The backup is the file's own bytes, so every key this build has never heard of comes back the way it went in.

## 🎨 Design

- **The cross and the check were reaching too far.** A cross puts its tips on the corners of its box and a round glyph puts its ink on the edge midpoints, so the same box makes the cross reach sqrt(2) further. Measured at 9.49 against 7.0.
- **The direction arrows carried a bar** behind the arrowhead, which is the "jump to the end" keyboard idea rather than a direction. One drawing now, turned.
- **One height for everything that stands in a row with a field.** An input took its height from its padding and the button between two of them was written as a separate number. Neither was wrong alone.
- **The settings strip is tabs rather than a groove.** A strip in a track reads as one control with a slot, whatever size it is.
- **The quiet period is a number and a unit** rather than a text box with a syntax to guess, and the number answers the mouse wheel while the field has focus.

## 🐛 Fixed

- **A file held open by another program** was only probed for copies. A rename of an open file, a conflict between two open files and a deletion that could not bin its victim all fell through to a generic failure with a raw system message attached, and renames were never probed at all. The files are now asked directly after a failure, because the transfer writes a partial file and renames it into place, and Windows refuses that rename onto a held file with plain access-denied rather than a sharing violation.
- **A weak agreement said nothing about being weak.** Checksum verification after a transfer was already there; what was missing is that "this backend has no checksums" and "this file could not be read" arrived as the same empty answer, and the comparison quietly dropped to a length and a clock reading.
- **Three reasons the engine really gives had no wording at all**, so a plain delete printed a path, a colon and nothing.
- **The folder picker's buttons wrapped onto two lines** in German, and the window is wider now so the row is a promise rather than a hope.
- **The language picker and its flags were a size too small.**

## 📚 Documentation

- **The example configuration shows the new settings again**, and two guards keep it that way: one loads it through the same function that guards a hand-written file, the other checks that what the README points people here for is actually shown.

## v0.4.2

### 🐛 Fixed

- A new build could keep showing the old interface. An embedded file has no
  modification time, so the server sent no Last-Modified and no ETag either,
  which leaves a browser with no validator at all. Every embedded file now
  carries a SHA-256 of its own bytes as its ETag.
- A bundle that no longer exists was answered with the page and a 200 instead
  of a 404, so a browser holding an old page was handed HTML where it expected
  a script and went on showing what it had.

### ⚡ Improved

- Two cache rules: the page revalidates every load, content-hashed bundles are
  kept for a year and never asked about, because a changed file arrives under a
  different name.

## v0.4.1

### 🐛 Fixed

- The folder picker's "make a folder" refused a name containing a slash and,
  on Linux and macOS, let a backslash through: `filepath.Separator` is "/"
  there, so the check asked twice for the same character. A folder literally
  named `sub\deeper` could be created inside the parent. It never escaped the
  parent. Caught by the CI on the two platforms this machine is not.

## v0.4.0

Thirty-eight reported points in one pass. The largest was not a look: a job
could not be deleted at all.

### 🐛 Fixed

- A job could not be deleted. The editor never wrote the file, and underneath
  that the validator refused a configuration with no jobs, so removing the only
  job could never be saved.
- The schedule lost its mode the moment you picked one, because which mode was
  showing was read back out of the stored expression.
- The colour picker moved the live colour to a different swatch while it was
  still open.
- The motion switch could not reach a single animation. Fixed in the design
  language, so every app that copies it gains a switch that works.
- The languages have real flags on Windows, and the picker is the house one.

### 🎨 Design

- The text is the same size as in the other apps here, measured on both.
- A selector segment carries the whole control radius, so the strip is no
  longer nearly square at the middle shape stage.
- The settings strip reads as a tab bar.
- The appearance wording matches the other apps, in all forty-two languages.
- One card per job while editing it, not two.
- The delete window lost its second cancel button and both divider lines, and
  can take the job's state database with it.
- The direction control is two plain arrows.
- Every button and switch answers to the label engine and the colour engine.

### ✨ Added

- An "every N" schedule, in minutes, hours, days or weeks.
- A folder can be made from inside the folder picker.
- Drives and targets appear inside the picker rather than under the field.
- A new job starts with sensible exclusions.

### ⚡ Improved

- Renaming a job carries its state database along.
- The storage form asks for what the provider requires and nothing else.
- The quiet period sits beside the schedule and says what to type.
- Name and state database line up with the two sides below them.
- The plus button sits top right, alone.

## v0.3.0

The interface's controls now come from GlimStone itself rather than being
rebuilt from its description, and the last control that still came from the
operating system is gone. The engine is unchanged.

### 🎨 Design

- The controls are the design language's own files, copied and edited nowhere,
  rather than this app's reading of its prose.
- The stylesheet block borrowed from BombVault is gone: GlimStone 1.7.1 defines
  those classes and measurements itself.
- Every picker in the app is one control, a portalled and edge-aware listbox,
  where there used to be four native selects.

### 🐛 Fixed

- The languages have real flags. Windows draws the flag emoji as a two-letter
  tag, which could not be fixed while the list was a native one. Catalan,
  Galician and Basque get a flag for the first time.
- The autostart switch is checked on the wire. The test decoded the answer into
  a shape without those two fields and walked past them.

### ⚡ Improved

- The About card names the design language release it is actually built from.
- A picker no longer grows with the name inside it.

## v0.2.0

The appearance settings and the jobs page rebuilt against BombVault's own
source rather than against the design language. The engine is unchanged.

### 🎨 Design

- Every selector segment and every switch row takes its own position in the
  palette. They all took the single accent, so with rainbow mode on a three-way
  picker read as one accent and two greys.
- Accent and rainbow are one card, and it comes last.
- Every colour swatch opens the picker, and there are eight presets rather than
  five. A swatch keeps its size when picked.
- Both reset controls are always present, disabled when there is nothing to
  undo, at the end of the row they reset.
- The settings cards are capped at a reading width, and the settings tabs have
  glyphs.
- One card per job, each with its own palette position.

### ⚡ Improved

- A selector no longer wraps onto a second line to keep its segments the same
  width; they shrink together where there is no room.

### 🗑️ Removed

- The "Right now" card at the top of the jobs page. The file being moved and the
  side it lands on now sit on the job making them.

## v0.1.1

A same-day fix to the one thing v0.1.0 was cut for.

### 🐛 Fixed

- The Windows installer claimed to be version 1.0.0, the build tool's own
  placeholder, while the portable exe beside it was already correct. Both now
  carry the same build identity. Found by reading the version out of the
  published bundles rather than assuming they carried what the build was told
  to put in them.

## v0.1.0

The first cut. A two-way sync engine that shows you the plan before it moves
anything, with the scheduler, the interface and the packaging around it.

### ✨ Added

- The preview screen: every proposed change with its direction and reason, each
  row untickable, and nothing touched until you press the button.
- A per-file record of what both sides last agreed on, which is what makes "here
  but not there" answerable instead of ambiguous.
- Rename detection, so renaming a folder of photos does not re-upload them.
- Conflicts keep both versions and still converge.
- Jobs in a configuration file, with a scheduler, a queue, a run log and
  notifications to Matrix or a webhook. A job never overlaps itself.
- Watching a local side, so a run starts because something happened rather than
  because a clock struck.
- A direction per job, drawn as an arrow and switchable between both ways, left
  to right and right to left. A one-way job rebuilds what points the wrong way
  instead of dropping it, so it converges rather than drifting.
- Drives and shares remembered by a marker written on them rather than by their
  letter, and a job that postpones itself when its disk is not plugged in.
- Local disks, SMB shares, SFTP and anything speaking the S3 API, through rclone
  as a library rather than as a subprocess.
- A browser interface in GlimStone with 42 languages, a folder browser on both
  sides of a job, a live card of what is happening right now, a reveal control
  on every secret field and a question before anything irreversible.
- A container, desktop builds for Windows, Linux and macOS, and an Unraid
  template. Windows gets both an installer and a portable exe.
- A notification area icon that turns while a sync runs, settles green on
  success and red on failure, and opens a small activity list on a click.
- Starting with the system, as a per-user entry needing no administrative
  rights, with the switch reading its state back from the operating system and
  the entry re-pointing itself when the program moves.
- `runAtStart` per job, for the machine that was off overnight and would
  otherwise wait until tomorrow.
- A version in the Windows file properties, in `arrowloop version` and on the
  About card, all three read from one stamp at build time.

### 🛡️ Safety

- Deletions go to a trash inside the losing side, never straight out.
- A run that would delete more than half the known files stops and names the
  paths.
- A side that lists nothing while the record says otherwise is never believed.
- A record is only written once both sides have been re-read and found to match.
- One file failing postpones that file rather than stopping the run, and
  postponing is not agreeing.
- Adding an exclude pattern hides files rather than deleting them.

### 📎 Known limits

- Symbolic links, sockets, pipes, devices and Windows junctions are reported and
  not carried.
- Hard links arrive as independent copies.
- Cloud providers that need OAuth (OneDrive, Google Drive, Dropbox) are not
  built in yet.
- The desktop builds are not signed.
