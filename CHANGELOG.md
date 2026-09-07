# Changelog

Every release is written by hand. There is no generated list of commit subjects
here, because that is a record of what was typed rather than of what changed for
the person reading it.

The full notes for each release are in
[`.github/release-notes/`](.github/release-notes/) and on the
[releases page](https://github.com/junkerderprovinz/arrowloop/releases).

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
