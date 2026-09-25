# Changelog

Every release is written by hand. There is no generated list of commit subjects
here, because that is a record of what was typed rather than of what changed for
the person reading it.

The full notes for each release are in
[`.github/release-notes/`](.github/release-notes/) and on the
[releases page](https://github.com/junkerderprovinz/arrowloop/releases).

## Unreleased

## 🎨 Design

- **The logo's easter egg is drawn anew.** Five quick presses on the logo, or one long press, send the arrows along the gap in the rings into the middle, where they curl into a ring. The ring spins the way the heads point, faster and faster, tightens, and throws the arrows out through the gap they came in by. A shock wave runs over the rings, the whole rail shudders from top to bottom, and two new arrows strike home and quiver. Every frame is computed, so the shafts bend smoothly, and the desktop app on macOS and Linux shows the bend too. The motion setting sets its pace and how hard the rail shakes; with motion off, or with reduced motion outside the storm, it does not play.

## 1.1.0 - 2026-09-25

## ✨ Added

- **A privacy policy**, `PRIVACY.md`: what ArrowLoop keeps on the device, what leaves it and where to, and what each Android permission is for.
- **The Google Play listing**, under `fastlane/`: the texts in English and German, the icon, the feature graphic and the screenshots. A release also builds the app bundle Play takes, signed with the release key.

## 🎨 Design

- **Give without leaving the app.** In the web interface and the desktop app, the coffee and PayPal buttons on the About card open a window instead of a browser tab. The coffee window holds Buy Me a Coffee's own form; the PayPal window asks how often and how much, then offers PayPal's button and a card button for anyone without a PayPal account, and gives monthly and yearly donations as well as one-off ones. Nothing from either service loads until its window opens. The Android app keeps its links. On macOS and Linux the desktop app's PayPal button opens PayPal's donation page in the browser instead, because the window's login needs a popup the app cannot open there.
- **The App tab offers each way to get ArrowLoop as a tile**, the same shape as in KnightLoader. The phone card has Google Play, marked "soon" until the listing is live, and the APK with the Android mark, with a Download button and a QR code button beside it that turns the tile into a code to scan. The app's version stands in the card's corner, linked to its release.
- **The second card offers what you are not already running.** In the container it offers the desktop app for Windows, Windows on ARM, macOS and Linux; in the desktop app it offers a server instead: Unraid's Community Applications, marked "soon" until the listing is live, the Docker image, whose tile copies the command that starts it, and the source code as Source code.zip, named in the reader's language.
- **Windows gets one download per processor, the installer.** The portable exe kept its settings under AppData like the installed program, so all it spared was the installation, and a Windows service belongs in a folder only administrators can change. `arrowloop service` says so too, since the service also runs the jobs' before and after commands as LocalSystem.
- **The README's download buttons sit right under the description**, before the donation text, and start with a Docs button for the manual.
- **The README's download rows gain Windows on ARM, a source button and a second one for the phone**: Google Play, drawn without a link until the listing is live, beside the APK.
- **The look follows GlimStone 2.11.0**, whose App tab this is: the tiles and their marks come from the design language, so every app offers its downloads the same way. The page behind a window is blurred and a little darker. In the round shape every button, tab, badge and switch is a true pill, a fresh install starts on soft corners, and a fourth shape hides behind square for whoever keeps clicking it.

## ⚡ Improved

- **The Android app no longer asks for the one-tap battery exemption.** Its switch opens the battery optimisation list instead, where ArrowLoop is set to not optimised. The prompt needs a permission Google Play grants to few kinds of app.
- **The Android app's data stays out of Android's cloud backup**, since it holds the access details of your storage targets. The settings backup in the app is the way to move a setup to another phone.

## 🐛 Fixed

- **The phone's settings page is titled "Settings"**, not "Settings section", which is the name of the web interface's section picker.
- **A file keeps its capitals in the preview and the history.** Where one side ignores case, as a phone's shared storage does, the preview listed "garden plan.pdf" and the history logged a deletion, a conflict or an unchanged file the same way. Both show the name as the side holding the file spells it.
- **Counts and times no longer read "1 files" or "1 minutes ago".** The phone's overview shows how many files moved as a number and a run's length as minutes and seconds, and the phone shows when something happened as a date and time. In the web interface "5 minutes ago" comes from the browser, with the right plural in every language. The statistics' run count and the unhashed-file note put the number after a colon.
- **With the theme on System, a light desktop shows the Sunflower accent**, as Light picked by hand does. It showed an olive one.
- **A dropdown answers the mouse wheel only after it has been clicked or reached with Tab.** Scrolling the page with the pointer over one no longer changes its value.
- **Links out of the desktop app open in the default browser.** On macOS and Linux the GitHub and email buttons and the version numbers on the About card did nothing, and so did the downloads and the version link on the App tab, because the app's window cannot open a second one. On Windows they opened a bare window with no address bar. They now go to the default browser or mail program on every platform.

## 1.0.0 - 2026-09-25

The first release of ArrowLoop: two-way sync between any two places rclone reaches, run on a schedule, in real time or by hand, with every change shown before it happens and a record of what both sides last agreed on. It runs as a container, a desktop app on Windows, macOS and Linux, and an Android app.

## ✨ Added

- **Two-way sync decided against a record.** Each run compares the left side now, the right side now and what the two agreed on last time, so "here but not there" is never a guess. An edit beats a deletion, and an edit on both sides keeps both versions under the plain name and a `.conflict-` name, on both sides, and the job still converges.
- **Every target rclone has**, built in as a library: local folders, SMB, SFTP, WebDAV (Nextcloud, OpenCloud), S3-compatible storage, OneDrive, Google Drive, Dropbox and the rest. A cloud that signs in through a browser takes a token made once.
- **One-way jobs, a mirror and a move mode**, besides two-way sync. A one-way job restores its destination instead of skipping what changed there.
- **Nothing is deleted outright.** A deletion moves the file into the side's own trash, which the interface lists and restores from. A run that would delete more than half the known files stops, and a side that suddenly lists nothing is not believed.
- **A record is written only when both sides really agree.** The engine re-reads both sides after every action, a crash at any step leaves a state that is smaller than reality but never wrong, and a consistency check finds a record that went wrong some other way.
- **Names that differ only by Unicode form or by case** are matched as one file where either side cannot tell them apart, and a renamed folder is moved instead of copied again.
- **Half-written files wait.** A file has to sit unchanged for a quiet period before it travels, and the names programs use while still writing never travel at all.
- **Files another program holds open** are postponed with that as the reason, and on Windows with administrator rights, as `arrowloop service` has, a plain copy of one is read from a shadow copy of its volume instead.
- **Schedules, real time and runs at start.** A job runs on a cron schedule, when a local side changes, once when the program starts, or when somebody presses the button. A job never overlaps itself, and a failed scheduled run is tried again a few times before it waits for the clock.
- **Commands before and after a run**, to write a database dump or stop a service first and start it again afterwards. They can only be written in `arrowloop.json`, since anybody who can reach the interface could otherwise run anything on the machine.
- **Every change can be reviewed first.** A preview lists what a run would do, single changes can be dropped from it, and a conflict can be decided by hand.
- **Every run is written down**, with a line per file that says what happened and where: uploaded, downloaded, deleted locally or in the cloud, copied to a drive. Notifications go to Matrix or a webhook, for failures only unless asked for more.
- **A web interface** for jobs, targets, the history, the trash and every setting, protected by a password, two-factor authentication and passkeys. The whole setup exports to one file and imports back.
- **A desktop app** for Windows (also on ARM), macOS and Linux, with the same interface in its own window, a tray icon and start at sign-in. Nothing listens on the network.
- **An Android app** that runs the engine on the phone, so the phone's own photos and folders can take part in a job, with the jobs, the history and the settings of the web interface.
- **A container image** for amd64 and arm64, with an Unraid template, and a single binary with a command line for scripts: `sync`, `run`, `daemon`, `jobs`, `history` and `service`.
- **Encryption at the destination**, a bandwidth limit with a timetable, versions kept of overwritten files, and a check for free room before a scheduled run starts.

## 🎨 Design

- **The look is GlimStone 2.9.0**, the design language shared with BombVault, KnightLoader and TrickWork: light and dark themes, corner shapes, an accent colour of your own or a rainbow palette, and a hidden Disco mode.
- **Labels as text, symbols or both**, set separately for buttons, the sidebar and tabs, without the layout moving when they change.
- **Three motion levels and a hidden fourth**, from off to wild and storm, in the browser and on the phone, where cards fly in on every tab and a page springs back at its edges. Asking the system for reduced motion stills the three levels you can pick.
- **42 languages**, the same in the interface and the phone app, set in Noto Sans.
