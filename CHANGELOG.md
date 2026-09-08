# Changelog

Every release is written by hand. There is no generated list of commit subjects
here, because that is a record of what was typed rather than of what changed for
the person reading it.

The full notes for each release are in
[`.github/release-notes/`](.github/release-notes/) and on the
[releases page](https://github.com/junkerderprovinz/arrowloop/releases).

## v0.6.1

A folder this program creates on a network share can now be written to, which it could not before. If you run the container on Unraid or any other box where the share belongs to somebody other than root, this one matters.

## 🐛 Fixed

- **A folder created through the browse panel came out unwritable on a share.** It was `root:root` with mode 0755 while the share around it was `nobody:users` with 0777, so the person who asked for the folder could open it and not put anything in it. The mode handed to `Mkdir` is only a ceiling: the process umask masks it, and a container's default of 022 is exactly what turns 0777 into 0755. A new folder inherits the mode AND the owner of the folder it is created in now, which is the right rule rather than a fixed mode - it makes the new folder behave like the one it sits in, and that is correct on a private disk as well as on a world-writable share. Reported with the Windows dialog attached, and measured on the box before anything was changed.
- **The files a run copies had the same defect, arriving quietly.** A folder you cannot write to announces itself immediately; a copied file that belongs to root does not, until somebody tries to edit it. That write belongs to rclone, so there is no moment for this program to step into and no way to fix it the way the folder was fixed. `ARROWLOOP_UMASK` covers it at the one lever that reaches every create the process makes. The container image sets `000`, which matches the share it writes into; a desktop install sets nothing and nothing changes there, because there the process is the user and the owner is already right. The Unraid template carries the field with `000` filled in, never blank - a blank template field overrides the image default rather than falling back to it.

## ⚡ Improved

- **The engine tab saves as you change it, and its save button is gone.** A page of settings is not a form somebody fills in and submits: every control on it stands alone, so a button at the foot means a switch flipped at the top does nothing until you scroll down and find it. Writing is delayed by a moment, because half of these controls are text boxes and saving per keystroke would refuse "1" on the way to "1M" and flash an error at somebody typing correctly.
- **A refusal now sticks to the bottom of the window.** That is the price of taking the button away: with a button the answer appears where the finger just was, and saving as you type puts it at the foot of a long page while the eye is on a field near the top. Only a refusal sticks; "saved" is not news worth pinning over the page.

## 🎨 Design

- **The README has a row of download buttons above its contents,** one per platform, drawn from a template rather than by hand. They link straight to the newest release: the release workflow now uploads each bundle twice, once with the version in the name and once without, because GitHub serves `releases/latest/download/<name>` only on an exact name and every versioned link in a README goes stale at the next tag.
- **The paragraph explaining the name explains the current one.** It described what a manorial reeve did, which was the working title's story and not this program's.

## 🧹 Housekeeping

- **The language bar stops counting the translation tables as if they were the program.** 1.26 MB of the repository is forty-two locale files and a generated glyph file holding raw SVG paths, all wearing a `.ts` extension, which made TypeScript the "main language" of a program whose engine is Go. Marked as data in `.gitattributes`: Go 0.97 MB against 0.63 MB of actual interface code.

## v0.6.0

Two rounds of live review. The job card told you the same thing three times, its buttons ignored the one setting that governs them, and the three explanations on the schedule panel explained the wrong things.

## ✨ Added

- **A dropdown switches on the mouse wheel.** Every picker in the app: hover it and roll, and it steps through its values without opening. It clamps at both ends rather than wrapping, because one notch too many should not land a value from the other end of the list. GlimStone has promised this for a native `<select>` since 1.5.0, and this app replaced its last one, so the behaviour went with it.
- **The whole setup travels in one file, from where you would look for it.** Export and import sit under Settings, General, next to the language, rather than among the engine's own settings: those are values the engine reads, and this is the file that holds all of them plus every job. The buttons are named for the acts and wear one box glyph with the arrow reversed. The confirmation before an import is the app's own window now, not the browser's grey box, which was the one dialog in the program that no setting reached.
- **The job card leads with what the job IS.** The two paths in large type with the arrow between them, and the mark the logo is drawn from standing at the far left as the status display. It was a 12px row with a 14px arrow, set in the same size as the schedule under it, so nothing on the card led.
- **Its schedule, in words, at the top right.** "runs every 3 hours" rather than `@every 6h`, and "runs Mon, Fri at 03:00" rather than `0 3 * * 1,5`. The card was printing the engine's own vocabulary at somebody who never asked to learn it. Under it, the last run with a real date and time, because the relative form answers "is this thing alive" and cannot answer "was that before or after I changed the folder".
- **An activity log on the card, folded away.** The same rows the history draws and the same detail panel under them, for this one job. It was nowhere: the card said when the job last WORKED, and everything else meant leaving the page and reading a list of every job's runs.
- **Real time is a schedule now, not a switch beside them.** It was a toggle under the strip, which made it read as an extra rather than as one of the answers, and that is exactly how it went missing in the first place. Picking it also writes a BACKSTOP, shown right there and editable: the engine has always refused a watching job with no schedule, because a watcher can miss an event and never know it did, and that requirement is now visible instead of implied.
- **A second standardised button height, and there will not be a third.** The button that creates a job and the direction switch stand one step up, at 2.5rem. There was exactly one height before, which is right for every button that stands in a row of fields and could not answer the button a page is about. Raising the one height would have put every control in the app out of line with every field beside it to solve a problem two controls have.

## 🎨 Design

- **The steppers on a number field are inside the field again.** They were being placed against the edge of the COLUMN: a labelled field is a column flex container, and the default stretch spread the wrapper across the full width while the box itself stayed at 6rem, so two arrows sat at the far right of the row with the field alone on the left. Four fields, one declaration. GlimStone 1.7.5.
- **The both-ways arrow is two arrows.** The transform list reads right to left, and the old one squashed the arrow along its length rather than across it, then pushed it off the top of the box before the rotation turned that overrun into an overrun off the right edge. Both halves ended up with their shafts in the same horizontal band, so it drew one broken bar with clipped stubs. It is a stacked pair pointing opposite ways now, measured rather than assumed: tips at 11.1 and 2.9 across a 14-unit box, symmetric about the middle.
- **Every button is in the colour and label engines.** Sixteen row actions were badges, which put them outside the one setting that decides what a button shows, and twenty-two more passed no translation key, so the glyph resolver could not pick them a symbol and they fell back to text in the two modes that exist to hide it. The resolver itself was eight keys against forty buttons and is a rule table now.
- **The three buttons on the About card have their marks.** That card is GlimStone's own, byte for byte; what was missing was that the app had never told the resolver what `about.repo` looks like.
- **One control, one hover bubble.** Seven elements carried both a `title` and the app's own `data-tip`, so each opened two bubbles saying the same sentence, the second drawn by the operating system a moment later, at the pointer instead of at the trigger.
- **The direction switch is no longer blank in text mode.** Its only child is its glyph, and the rule that hides a glyph in that mode had no exception for a control that has no words to fall back to.
- **The unit picker beside the quiet period is a fixed narrow column.** It holds one of three words and was being handed every pixel the row had left over: half an editor row in the job form, and most of a card on the Engine tab.
- **A new job's quiet period starts at five seconds.** An empty box is a real setting that means "act on the first event", which is the one answer nobody wants when a folder of a thousand files arrives at once.
- **The job card's seven controls are one row of one control.** Every one of them paints in its card's own colour instead of a flat grey the colour engine cannot reach, and every one of them answers the app-wide label setting: words where the setting shows words, a row of square tiles where it does not. Five of them used to be permanently glyph-only by a documented exemption, which from outside looks exactly like five controls ignoring the setting, and was reported as such twice. The activity fold's button stands with them now rather than pushed to the far end, and its list opens under the whole row.
- **A glyph alone in a square is half its box.** 20px is the right size beside 14px text, where a mark and its words have to read as one control; in a 32px tile there are no words to match and 20px fills 62% of the frame. Reported as chunky, and it was: the sibling app's own icon tiles have carried a 16px drawing in a 32px box all along.
- **The unit beside "every N" and beside the backstop is a dropdown.** It was a four-segment strip spelling out minutes, hours, days and weeks next to a number box, which spent most of a form column saying one word.
- **Every explanation in the app is in a bubble.** Three were still printed as grey paragraphs on the page. Prose under a control is read once and then costs vertical space for ever, and there is a guard for it now: a translation key whose name says it explains something may only be passed as a prop, never rendered.

## ⚡ Improved

- **A new job arrives switched on.** It arrived held purely so the validator would accept it before it had any sides, so every job anybody created announced itself as disabled until they found a switch at the bottom of the form. A job with NEITHER side is a draft now and loads: it has no schedule, so nothing reaches it. A job with ONE side and not the other is still refused when it is switched on, because that is a form half filled in rather than a draft. A duplicate still arrives held, and that is deliberate: it points at the same two folders as the job it was copied from, with a state database of its own.
- **The job form has no active switch at all any more.** A new job has arrived switched on for a while, so the switch spent its life showing the answer it was created with, and holding a job is not something anybody decides while filling in a form. That control lives on the card, next to the one that starts a run by hand, and it saves itself.
- **The schedule, the settle time and the backstop say what they are FOR.** All three explanations described the mechanism instead of the reason, and the schedule's still described a cron field that has not existed since the builder replaced it. They now name the six positions, count the fifty events a folder of fifty files produces, and say plainly that only the side on this machine can be watched, which is why the backstop exists at all.
- **Four button labels that were written as tooltips are verbs again.** "Edit this job" reads well spoken on hover and badly printed on a button, and four such sentences wrapped the card's action row onto two lines.
- **The bandwidth limit explains itself.** The old text said how to write the value and never what the setting does or what to put in it. It now answers both, in that order, and says the honest thing first: leave it empty unless a sync actually makes the rest of the network unusable.
- **The card says a job is held once, not three times.** A badge reading "disabled", the word "disabled" beside it, and "never worked" beside that, all on the same card. The state is the mark at the other end of the row, which was already carrying it in colour and in its own tip.

## 🐛 Fixed

- **A bandwidth limit now takes effect when it is saved.** It was written to the file and nowhere else, so the setting was correct, the page showed it, and the next transfer went at whatever speed the program booted with. A plain limit applies to the next transferred block; a timetable applies its current slot the same way and its later slots are followed by a ticker that is started here if the process booted without one.
- **An invalid bandwidth limit is refused when it is saved.** It saved cleanly and the program then refused to START on the next boot, which is the worst place to find out: the message goes to a console nobody is watching, and the interface that could have shown it is the thing that is no longer running.
- **The unsaved job's row is the same row as a saved one.** It was drawn at 12px with a 14px arrow beside cards at 16px and 20px, so one page showed two different kinds of job row and the unsaved one read as a footnote.
- **The settle time's own explanation belonged to something else.** The bubble beside it carried the paragraph about what real time IS, so the one control on that panel that needed explaining was the one whose (i) answered a different question.
- **Picking real time no longer opens with a settle time of zero.** Zero means acting on the first event of a copy, which is the answer the setting exists to avoid, and a zero sitting in a field reads as a considered value. It is seeded with the same five seconds a new job's quiet period gets.

## 🗑 Removed

- **Report-only is gone.** A schedule that ran the whole comparison and applied nothing answered a question the preview button already answers, on demand, without a setting somebody has to remember to switch back off.

## 🌐 Translations

- **Eighteen new strings in all 42 languages**, and eleven dead ones removed from all 42. The dead ones were strings nothing rendered, and they were found by reading rather than by anything failing, so there is a guard for that now.
- **Ten rewritten strings in all 42 languages, not just the two written by hand.** Four of them are the explanations above, and leaving forty languages describing a cron field the app no longer has is not a smaller version of translating them: it is the same defect in forty places. Each language names the schedule positions with its own words for them, taken from its own table rather than from English.
- **The cadence sentences were translated as sentences, not as words.** "runs every 3 hours" is assembled from two keys, and several languages cannot put them in that order or need a case the plural unit list cannot supply. Czech, Polish, Lithuanian, French, Hungarian, Finnish, Danish, Basque and Estonian each got a construction that is correct across the whole range of counts rather than one that is right at five and wrong at three.

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
