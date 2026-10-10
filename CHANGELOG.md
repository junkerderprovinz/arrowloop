# Changelog

Every release is written by hand. There is no generated list of commit subjects
here, because that is a record of what was typed rather than of what changed for
the person reading it.

The full notes for each release are in
[`.github/release-notes/`](.github/release-notes/) and on the
[releases page](https://github.com/junkerderprovinz/arrowloop/releases).

## Unreleased

## 1.6.3 - 2026-10-10

## ⚡ Improved

- **The phone app has a Save button for a new job.** Before, the form wrote the job as soon as it had a name and both sides, so it could start running before you had set its direction and schedule. A new job is written when you press Save, and Cancel leaves without one. An existing job still saves each change as you make it.

## 1.6.2 - 2026-10-04

## 🎨 Design

- **The README's download buttons come in groups.** The server comes first, then the desktop apps, then the Android app, with more room between the groups. The screenshots are in the same order.
- **How it compares is back in the README.** The table that sets ArrowLoop against GoodSync, FreeFileSync, Syncthing and five other tools sits between What it does and Getting started.

## 1.6.1 - 2026-10-04

## 🎨 Design

- **The Save button has a new floppy.** It is Material Design Icons' `content-save` (Apache 2.0), the same drawing GlimStone 3.1.6 uses. The old one came from Vecteezy under a licence that is not open, which F-Droid counts as a non-free asset.

## 1.6.0 - 2026-10-03

## 🎨 Design

- **The download buttons name the system first.** The ARM64 builds read Windows or Linux over ARM64, in the App tab and in the phone app, like the x64 builds beside them.
- **The README shows the Android app as wide as the desktop app and the container,** with three phones in front of the clouds and servers ArrowLoop syncs with.

## ⚡ Improved

- **The Unraid buttons lead to ArrowLoop's entry in Community Applications.** In the App tab and in the phone app they said it was coming; the README has an Unraid button of its own, and the installation guide starts with the entry.

## 1.5.0 - 2026-09-29

## ✨ Added

- **The desktop app for Linux on ARM64.** The release has `arrowloop-linux-arm64` next to `arrowloop-linux-amd64`, the README and the App tab link to it, and it updates itself like the other builds. It needs WebKitGTK 4.1, as the amd64 build does.
- **`ARROWLOOP_TRUSTED_PROXIES`** names the reverse proxies whose `X-Forwarded-For` the login lockout may believe, so one stranger behind the proxy can no longer lock everybody out. See "Behind a reverse proxy" in the installation guide.
- **`ARROWLOOP_HOSTS`** adds names an installation without a password answers on, besides IP addresses and local names such as `nas.fritz.box`.

## 🎨 Design

- **New pictures on Google Play and F-Droid.** The first one shows the clouds and servers ArrowLoop syncs with, under the line "Sync it everywhere."; five dark screenshots of the app in a drawn phone follow, each under a short caption, in German and English. The feature graphic and the README banner use the same line.
- **A shorter README with pictures.** It shows the desktop app, the container and the Android app in the style of the store pictures, and the call for Android testers sits at the top where nobody can miss it. The long explanations are in the documentation.
- **The buttons in the phone's settings fill their card.** Each row shares the card's width between its buttons, and the desktop card has one row per system, so each ARM64 build sits next to its own.

## ⚡ Improved

- **The Android app is `arrowloop.halleluja.design`.** The same pattern as the other apps. Android treats a new package name as a different app, so this version installs next to an older one instead of replacing it. To keep your jobs and targets, export them under Settings, Back up and restore settings in the old app, import the file in the new one, then uninstall the old app.
- **The documentation covers everything the README explained.** New pages describe the interface, the comparison with other tools and the tests, and the fields `mode`, `retry` and `historyKeep` are documented for the first time.
- **F-Droid can build ArrowLoop from source.** F-Droid builds every app itself and refuses a source tree with prebuilt binaries in it. The Android project keeps its release version in `mobile/app.json`, where F-Droid reads it, and the engine can be compiled after the Android project is generated. The store listings call the app just ArrowLoop.
- **The Android app is about 5 MB smaller.** The release build runs R8, which drops the code and resources the app never uses, and the app carries no web view: Buy Me a Coffee opens in the browser, like PayPal.
- Wails is updated to 3.0.0-beta.27 and the SQLite driver to 1.60.1.

## 🐛 Fixed

### Your files

- **Copy only and Move never delete on the destination.** A file or folder deleted on the source was removed on the destination too, although these modes promise to remove nothing. Only Mirror carries a deletion across.
- **Mirror counts its own deletions against the safety brake.** Switching a job to Mirror, or a first Mirror run onto a full destination, stops when it would remove more than half of the files, and a Mirror whose source lists nothing is refused.
- **Move mode keeps an archived file when a name comes back.** A phone that reuses a name such as `IMG_0001.jpg` no longer overwrites the copy moved earlier; the old one is kept beside it as a conflict copy.
- **A folder that cannot be read stops the run** instead of counting as empty, which made its files look deleted on the other side. Folders the job excludes, such as `System Volume Information` on a drive root, are not opened at all.
- **Default excludes starting with `**/` also cover folders at the top of a job**, so a `.git` or `node_modules` right in the job's folder is left out like one further down.
- **A file changed during a run is left for the next run** instead of being overwritten or put in the trash. This also covers the losing side of a conflict you decided and the new name of a rename.
- **Names that differ only in case or Unicode form stay one file**, and exclude patterns on such jobs no longer bring deleted files back.
- **One-way jobs** forget a file gone from both sides, and a rename on the destination no longer repeats on every run.
- **A file dated in the future** syncs instead of waiting until its date.
- **Preview runs exactly what it showed.** A ticked row whose action changed in the meantime is skipped and logged.

### Security

- **The Android app's engine only answers the app.** Other apps on the phone could use its API on port 8422 and reach your files and saved cloud logins. The engine now requires a token that only ArrowLoop holds and proves itself before the app sends it.
- **Web pages you visit cannot drive ArrowLoop.** Requests started by another site are refused, and an installation without a password only answers on an IP address, a local name or a name in `ARROWLOOP_HOSTS`.
- **The login lockout holds under parallel tries**, so the second factor can no longer be guessed.
- **A connection test uses a saved password only when nothing else in the form changed.**
- **Adding a passkey asks for the password**, and a new password, in Settings or through `ARROWLOOP_PASSWORD_HASH`, removes all passkeys.
- **Before and after commands can only be set in `arrowloop.json`**, however the interface spells the keys.
- **Saved targets no longer show their secrets in the interface.** What counts as secret comes from rclone's own marking of each option.

### Targets

- **Targets go where `RCLONE_CONFIG` points.** The engine is meant to follow rclone's `RCLONE_CONFIG` variable, but kept its targets in rclone's default file instead, which on a computer is the user's own `rclone.conf`. It uses the file the variable names.

### Encrypted targets

- **The second crypt password (the salt) is stored the way rclone expects.** Targets saved by an earlier version keep working as they are. Typing the salt in again changes it, so copy the old `password2` line from `rclone.conf` first if files depend on it.

### Running jobs

- **A failed run is tried again on a computer and in a container.** The **After a failure** setting under Settings, Engine only took effect in the Android app. Elsewhere a failed job waited for its next scheduled time.
- **`arrowloop daemon` keeps run records as long as `historyKeep` says.** At start it trimmed the log to ninety days whatever the configuration asked for, even with `"0"`, which keeps every record.
- **Saving a job no longer stops the runs of other jobs.** Removing or pausing a job stops or skips its own waiting run, and an edited job runs as edited.
- **Folders under a watched job can be renamed on Windows again.**
- **A before or after command that leaves a process behind** no longer holds the run past its timeout or Cancel.
- **A before command can mount the job's drive**, and the after command runs when the drive is still missing afterwards.
- **Notification targets and Jobs at once apply on save.** The run log path says that it applies at the next start.
- **Shadow copies left by a crashed run are removed at the next start.**
- **A file another program has open for writing is copied** when Windows allows reading it.

### Desktop

- **The desktop window no longer opens by itself while ArrowLoop sits in the notification area.** Every start opened the main window, including the one after an update and the one at sign-in. Starting with the session keeps ArrowLoop in the notification area, and so does a start after something outside ended it while the window was there, as an update does. Starting it by hand still opens the window.
- **The update folder under ProgramData belongs to administrators only**, and uninstalling deletes only the files the installer put there.
- **The scheduled update no longer fails** while an older copy is still running.
- **macOS:** a program path with `&` or `<` no longer breaks start at login.

### Web interface

- **Adding a job before the list has loaded** can no longer save a list that holds only the new job.
- **A new target with a name that is taken** is refused instead of replacing the old one.
- **Pause and Remove change only that job.** Removing a job above an open form no longer blanks the page, and a failed job stays red until it succeeds again.
- **An expired session returns to the login**, the "engine unreachable" banner clears again, and failed actions say why.

### Android

- **The Android app no longer closes itself a few seconds after opening when disco is on.** The walking rainbow redrew the whole app ten times a second at the highest priority, and once a screen took longer than that to draw, the redraws piled up until the app stopped. A full overview after a large run was enough. The colours now move at a priority that a slow screen can skip.
- **A scheduled sync no longer crashes the Android app when Android's daily limit for background sync is used up.** Android 15 allows six hours of it a day and refuses more until the app is opened again. The wake-up is now skipped quietly, and a run that reaches the limit halfway stops cleanly and reports itself as failed.
- **A fresh install on Android points out missing file access.** Nothing asked for the permission before, so a job with a folder on the phone found nothing to read. The overview lists File access under Waiting for you until it is granted, and a tap opens Android's page for it.
- **The Android app starts on x86_64 devices.** On emulators and Chromebooks the engine stopped the moment it opened its first database, and the app only showed its error screen. The SQLite library makes file system calls that Android forbids on x86_64 and kills the process for; the engine hands SQLite versions of those calls that Android allows. Phones with arm64 were never affected.
- **The open envelope on the Email button keeps its tip.** Pressing the button cut off the top of the flap.
- **Background syncs no longer crash on Android 12 and later** without the battery exemption.
- **Only on Wi-Fi, only while charging and the battery floor are checked before a run starts.**
- **A second wake-up no longer stops a long run**, and a wake-up no longer stops the engine under the open app.
- **New photos keep triggering a sync**, and "Start the engine" on the trouble screen starts it.

### Container

- **The arm64 image is started and health-checked** before a release is published, like the amd64 one.

## 1.4.0 - 2026-09-27

## 🎨 Design

- **The providers you pick a new target from are README buttons**, on the web and on the phone: the logo at the start, the name beside it, three to a row in the dialog so every name stands at full size, and one or two per row on a phone. A button lights up in its brand's colour under the pointer, on keyboard focus or under a finger, and a name too long for its button gets smaller instead of being cut off. On the dark theme the glyphs of SFTP, SMB and the other protocols turn dark on a lit button instead of staying light grey.
- **The sidebar shudders properly after the logo's easter egg.** Each row is shoved sideways by the level's amount and swings back three times, smaller each time, as KnightLoader's does, instead of a quick tremble that was barely visible.
- **The two tray switches are named for what they do:** Close to the notification area and Minimise to the notification area, in every language.
- **The small window at the tray icon can be resized.** Drag any edge or corner; it keeps the size you leave it at, also after a restart, and does not get smaller than 300 by 360.
- **The closed envelope on the About card's mail button sits in the middle of the button**, as GlimStone 3.0.1 draws it. It stood a little too low.
- **Every target says whether it is connected.** On the Targets page and on the phone's overview and Targets tab, each target shows Connected or Not connected as soon as it appears, from the same check as the Test connection button. A target that is only a folder on this device shows none, since it has nothing to connect to. The phone used to read it from the storage figures, which many services give without connecting.
- **Test connection shows its answer on the button.** In the target form the button turns green with Connected and a check when the test passes, and red with Not connected and a cross when it fails, as on the phone; a failure also shakes it and names the reason above the buttons.
- **Each target is a card on its group's card.** On the Targets page every cloud, bucket, server and drive stands on a surface of its own instead of in rows divided by lines.
- **The small window at the tray icon keeps the logo in its gold.** Only the tray icon itself changes colour with what runs, and the two buttons at the bottom take the app's colours.
- **The small window at the tray icon shows every job once.** Runs lists each job with its latest run and how often it ran today, so a job that runs on every change no longer pushes one that runs once a day out of the list.
- **Each file change in the small window says when and from where to where.** It shows the time and the full path the file came from and went to, cut at the start when it is long so the file's name stays readable.
- **Buy Me a Coffee opens in a window on the phone.** The About card shows the same window as the desktop, with the appeal and Buy Me a Coffee's own page in it, so you give without leaving the app. PayPal still opens in the browser, because its wallet login needs a window an embedded page does not open reliably.
- **The phone offers ArrowLoop's other forms.** Settings has a card for the desktop app, with Windows, macOS and Linux, and one for servers, with Unraid marked as coming until its entry is listed, the Docker command to copy and the source code, the same README buttons as the web's Apps page. Every download is the newest release.

## 🐛 Fixed

- **Background activity on the phone is granted with one tap.** The switch opens Android's own prompt to let ArrowLoop run in the background, where it used to open the list of optimised apps. Some manufacturers have a background switch of their own that does not exempt the app from battery optimisation, which left the switch off although that one was on.
- **A WebDAV address with nothing at it fails the connection check.** A login that worked against the wrong path, such as OpenCloud's /dav/ where its files are under /remote.php/webdav/, passed the check in the form and then showed as unreachable on the target's card. The check says the login works but nothing is at that address.
- **The phone's folder picker opens a target.** Tapping a cloud or server in the list chose its top level at once, so no folder on it could be picked. It opens like any folder, you can go into its folders, make one there and choose it, and a job whose side already points into a target opens the picker in that folder.
- **The phone's About card names the release it runs.** It read ArrowLoop dev, because the engine inside the app was built without its version; it carries the same version as the desktop and the container.

## 1.3.0 - 2026-09-27

## ✨ Added

- **Conflicts has a tab of its own, with a count on the sidebar.** Every open conflict of every job stands there with both versions, their size and time and which one is newer, and Keep left, Keep right or Keep both decides one row or all the chosen ones, with the same outcome as choosing before a run. A decided conflict, or one whose set-aside copy is gone, drops off as runs end, and the phone opens the list from the overview.
- **Trash has a tab of its own, with a count on the sidebar.** It shows every job's trash on both sides with sizes and dates, puts files back, and deletes one file, one side or everything listed for good after asking with the count and size. The job editor links to it narrowed to that job, and the phone opens it from the overview.
- **The job card shows how fast a run moves.** Beside the progress line it reads the transfer speed, such as 12.4 MB/s, in your language's number format. The engine takes it from rclone's own count of the bytes moved, so a file that finishes between two updates still counts, and it shows only while bytes move. The phone's running card shows it too, and the files-a-second figure next to it uses your number format as well.
- **A job's history and the History tab fill in while the run goes.** New lines appear within a second as files are copied, moved or deleted, and History lists the running run with what it has done so far. Once the run is stored, both show exactly what a reload shows: no line twice, and search, filters and scrolling for more work as before.
- **The small window at the tray icon switches between Runs and Files.** Files lists the latest changes across all jobs in the same words as the history and adds new ones while a run goes. The window remembers the choice.

## 🎨 Design

- **The look follows GlimStone 3.0.0.** The folder picker blurs and darkens the page behind it like every other window, and on the phone the page behind a window is a little darker on the dark theme than on the light one.
- **Every tile in the target dialogs lights up, from the keyboard as well.** Tab through the providers when you add a target, and the focused tile fills with the brand's colour as it does under the pointer, its name and mark in white or near-black, whichever reads on that colour. A protocol such as SFTP or SMB has no brand and lights up in the accent instead of turning a darker grey. On the phone a tile fills the same way while your finger is on it, and so does a coin in the crypto window.
- **Dark marks stand out on the dark theme.** A provider mark that reached less than 3:1 against its tile is drawn lighter in the same hue, just far enough to reach 3:1, as GlimStone asks of a graphic, so it stays close to the brand's colour: Dropbox's blue becomes #2d7dff, Nextcloud's blue #0089d3. That newly covers 14 providers, among them Azure Blob Storage, Backblaze B2, Box and MinIO, and marks that were drawn much lighter, such as ownCloud and Scaleway, move back towards their own colour. Under the pointer the tile still fills with the brand's own colour.
- **Every line of the history says what happened to the file.** No line reads "did" any more. A conflict says whether both versions were kept or which one, a copy over an existing file reads "Replaced in …", a rename reads "Renamed in …" with the old name beside it, a file sent to the other side reads "Moved to …", and a deletion says when it went into the trash. Runs recorded before this version keep the general wording, such as "Copied to …" or "Deleted in …", since the finer difference was not written down then.
- **The job card's Activity is called History**, like the History tab, and has a close button of its own; Escape closes it too, and Options, History still opens and closes it. The phone uses the same name.
- **The History tab switches between Runs and Files with a selector above its card**, the same control as in the tray window.
- **Adding a job is a floating button in the window's bottom corner.** It stays put while the list scrolls, and the list leaves room under its last card so no button hides behind it.
- **Pages end on the sidebar's bottom line.** The History card, and any page scrolled to its end, stops level with the bottom of the sidebar, as the first row already stands level with its top.
- **Browse targets sits at the end of its path field** in the job editor, as tall as the field, and drops under it when the window is narrow.
- **Each mode explains itself.** Copy only, Mirror and Move carry an (i) in their own segment, in the job editor, in the global sync settings and on the phone. Clicking it opens the explanation and leaves the mode as it is.
- **"Transfer immediately" is called Real time**, in the schedule, on the job card and in the global sync settings.

## 🐛 Fixed

- **Deciding a conflict after the run changes the files.** The choices in an opened run in History started a new run, which found no conflict left, since the first run had already kept both versions, so nothing happened. The run now counts the conflicts it kept both versions of and links to Conflicts, where the choice takes effect.
- **A job's trash can be reached in the browser again.** Its list sat in a part of the job card that never showed; the Trash tab replaces it.
- **The history lists only what a run did to files.** A file both sides already held got a line of its own that read "did", which on a first run over a full folder buried the few real copies under thousands of lines. Those files now count as unchanged in the run's numbers and leave no line, and runs stored before this version drop those lines from the history, the job card and the tray window too.
- **Both lists in the tray window scroll.** It asked for only the last 5 runs or 12 files, so there was nothing to scroll to. It now starts with 10 runs or 20 files and loads more as you scroll to the end, like the History tab.
- **Check this job and Find duplicates can be opened.** Both sat in the same hidden part of the card. They are in the card's Options menu now and open under the card with a close button, like its history.
- **A renamed file's line in the history shows its size.** The size was read under the new name on the side still waiting for the rename, where there was nothing yet, so it came out as nothing.

## 1.2.1 - 2026-09-27

## ⚡ Improved

- **The Windows installer puts ArrowLoop under Program Files for everyone on the computer** and asks for an administrator once, while it installs. It removes an installation under AppData\Local\Programs with its shortcuts and leaves your settings in `%APPDATA%\ArrowLoop` alone.
- **The installed app updates in the background, open or not.** A scheduled task called ArrowLoop Update runs once a day and after each start of the computer, as the system account, since nobody else may write to Program Files. Update automatically under Settings, General still switches it off, its log is `%ProgramData%\ArrowLoop\update.log`, and uninstalling removes the task.

## 1.2.0 - 2026-09-27

## ✨ Added

- **A run shows how far it has got before the first file moves.** Reading a large share can take minutes, and until now the job card showed a bar that ran back and forth next to "Starting", which looked like a hang. The card, on the desktop and on the phone, names each stage: reading the left side, checking it for links, the same for the right side, then comparing. Next to the bar it counts the files. While a side is read, the count is measured against the last run's record and reads "of about", since this run may find more. Speed and time left start afresh for each stage.
- **A job can follow the global sync settings, or leave them.** The job editor has a switch for it. While it is on, direction and schedule show the global values, greyed out. Turning it off writes the values the job runs with at that moment, so nothing changes until you edit one.
- **The folder picker walks your targets.** "Browse target" opens a configured cloud or server as a folder tree instead of taking its top level at once, and New folder creates the folder on the target.
- **The SMB form offers the shares Windows is connected to.** One click fills in server, user and domain. The folder picker shows a mapped drive's share next to its letter, such as `W: \\server\backup`.
- **A click on the icon in the notification area opens a small window at the icon**, the way OneDrive and the Nextcloud client do. It shows what is running now and the last five runs, with buttons to pause, to sync everything and to open ArrowLoop. A second click, a click elsewhere or Escape closes it, and a double click on the icon opens the main window.
- **The icon's menu is Open, Force sync, Pause sync or Resume sync, and Quit**, in the language the interface shows. Force sync starts every job straight away as if you had started each one by hand, so neither a pause nor the battery setting holds it back.
- **Sync can be paused from the notification area.** A pause holds every scheduled and watching run until you resume, stops the runs already going, and stays in place after a restart. The icon turns grey with a pause badge while it lasts.
- **The Windows installer asks about the shortcuts.** A page offers a Start menu entry and a desktop shortcut, both ticked, in German or English depending on the system. The next install, silent or not, starts from the last choice and removes a shortcut you left out.
- **The Windows installer installs for you alone**, under AppData\Local\Programs, so installing and updating need no administrator. An older installation for all users is removed on the way; that step asks for an administrator once. Run with `/S /relaunch`, it installs silently and starts ArrowLoop again afterwards, which is what an updater needs.
- **The desktop app keeps itself up to date.** Once a day it downloads a newer release in the background, checks it against the release's `checksums.txt` and starts it the next time you start ArrowLoop, with a note in the window once it is ready. An installed copy and a portable one both update where they are; Update automatically under Settings, General turns it off.
- **Every release lists the SHA-256 of its files in `checksums.txt`.** Windows also gets a portable `.exe` and macOS a `.zip` of the app, the files the desktop app updates itself from.

## 🎨 Design

- **The job card holds the full path and three buttons.** Pause, Run now and Options sit in one row with both sides' paths, which wrap instead of being cut short. Activity, Edit, Duplicate, Remove and Preview are in the Options menu. In a narrow window the buttons move under the path, and below 640 pixels the sidebar becomes a bar across the top.
- **The job editor lines up.** Settle time, fallback schedule and quiet hours stand under each other with fields of one width. The name stands over the left side and the state file over the right, and the direction button is larger and says the direction in words.
- **"What happens to the rest" is called Mode.** It is a selector in the job editor, as in the global sync settings, and its info bubble explains all three modes side by side, since two of them delete files.
- **Every page starts on the sidebar's top line.** The Settings tabs, the Jobs page's buttons and the card that opens Targets and History stood lower than the sidebar beside them; a card's title badge now meets that line.
- **The window options say what they do.** "Keep running in the notification area when closed" replaces "The close button hides the window", with a note on how to quit, and minimising reads "Minimised to the notification area".
- **The logo's easter egg is drawn anew.** Five quick presses on the logo, or one long press, send the arrows along the gap in the rings into the middle, where they curl into a ring. The ring spins the way the heads point, faster and faster, tightens, and throws the arrows out through the gap they came in by. A shock wave runs over the rings, the whole rail shudders from top to bottom, and two new arrows strike home and quiver. Every frame is computed, so the shafts bend smoothly, and the desktop app on macOS and Linux shows the bend too. The motion setting sets its pace and how hard the rail shakes; with motion off, or with reduced motion outside the storm, it does not play.
- **The look follows GlimStone 2.15.0.** The App tab and the About card use the README's download buttons, every selector spans its card, and cards, tabs and buttons get animations of their own.
- **The App tab offers each download as a README button.** At rest it is grey with the brand's mark. Under the pointer it takes the brand's colour, and a second line such as "x64" or "Universal" appears under the name. Windows on ARM hangs on the Windows button, and the APK's QR code hangs on the APK button, where it opens in a small window over the button. The Docker button copies the command that starts the container and says "Copied" for a moment. The source archive reads "Source code" over "ZIP archive", and Google Play and Unraid say "Soon" until their listings exist.
- **The About card gives and reports with the same buttons.** Buy Me a Coffee's button wears the vendor's own cup and lettering, the Email button's envelope opens under the pointer, and the give buttons stand a blank line apart from the sentences around them.
- **Every selector spans the width of its card**, including the weekday strip and the exclude sets. In the PayPal window the free amount stands under the presets.
- **The language picker opens the Look tab.** The General and App tabs have glyphs of their own, so the cog means Settings and nothing else.
- **More of the interface moves when something happens.** A tab's cards and new rows arrive one after another, a settings tab slides in from its side, the corners morph to a new shape, and a change of the rainbow wipes across the page. A copy button draws a check and pulses, the export pulses as well, a refused import or login shakes its message, and a run's file list fades in once it has loaded. The motion setting decides how much of this plays.
- **The crypto window's coin tiles light up in the coin's own colour** under the pointer, with the coin shown reversed.
- **On the phone, the About card has the same README buttons**, lit in the brand's colour while pressed, and the language card comes first in the settings.
- **On the phone, a button swells once when its work lands**: the copy button in the crypto window, and Export and Import on the settings page. The motion setting decides how far and for how long; at Off nothing moves.
- **A new install starts with motion at Gentle**, the middle level, as the other GlimStone apps do. Wild is one tap away, and a level somebody already chose stays as it is.

## ⚡ Improved

- **The desktop app runs on Wails v3.** It brings the notification area icon of its own that the small window needs, and the icon no longer depends on a separate library. The downloads keep their names.
- **Switching the icon off or on in Settings applies at once**, without a restart. On Windows and macOS the icon keeps its place in the notification area when it comes back.

## 🐛 Fixed

- **A job between two local folders or a mapped network drive no longer reads every file on every run.** The comparison asked each file for its checksum before looking at its size, and on a local disk that means reading the file to its end. The first run of a job over a full music library read both sides whole, the settled record read them again, and a run every few minutes started over before it finished, so it never did. A checksum that costs a full read is now fetched only where size and time cannot decide: a file whose time moved while its size did not, two edits of one file since the last run, or a job that insists on checksums. A copied file is still checked after the transfer.
- **Minimising and closing to the notification area work, and the icon answers reliably.** The icon was started so that it blocked the program's start: the watch that sends a minimised window to the notification area never began, and the icon's own window ran on no fixed thread, so clicks and redraws went missing now and then. The icon now belongs to Wails itself and stays in place however often the window hides and comes back.
- **The desktop window follows a run live.** On Windows the job card stayed on "Starting" until the run was over, because the window never received the run's progress: the webview hands a response over only once it is complete, and the live stream never completes. The app now sends each event into its windows directly, including the reading stages, and keeps only the newest progress per job so a run over many small files does not flood the window.
- **A stopped run shows up in the history.** Its record was written with the run's own stop signal still set, so it never arrived, and a run stopped from the Jobs page left no trace.
- **A new install starts without an example job.** The desktop app and the server wrote a disabled job called "example" on their first start, which then had to be deleted before the list was your own.
- **Stopping a run works while it compares files.** A checksum being read ignored the stop, so a stopped run went on reading the whole tree. The walk that looks for links on a local side ignored it too.
- **The "Add server or share" dialog speaks your language.** Its tile hints and names such as "SMB / Windows share" were English in every language.
- **A two-way job starts when the global mode is mirror or move.** It inherited that mode, which needs a source side, and the engine refused to run it.
- **The folder picker covers the whole window** instead of only the card it was opened from.
- **The phone draws the storage providers' marks the way the web interface does.** Proton Drive's mark was missing, and on the light theme several marks were darkened that the web interface shows in their own colours.

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
