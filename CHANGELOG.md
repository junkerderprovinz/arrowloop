# Changelog

Every release is written by hand. There is no generated list of commit subjects
here, because that is a record of what was typed rather than of what changed for
the person reading it.

The full notes for each release are in
[`.github/release-notes/`](.github/release-notes/) and on the
[releases page](https://github.com/junkerderprovinz/arrowloop/releases).

## 2.2.0 - 2026-10-14

## ✨ Added

- **Folders that other apps share in Android's file picker can be synced, without root or Shizuku.** Some apps, the keyboard Fcitx5 for Android among them, keep their files in their own storage and offer them in the system file picker. That is how FolderSync reaches them, and ArrowLoop goes the same way. In Settings, This phone, Add a folder from an app opens the picker, and each folder you pick shows up in a target called Apps. The file picker cannot set a file's modification time, so ArrowLoop remembers the time it gave a file and reports it until the file changes. ([#66](https://github.com/junkerderprovinz/arrowloop/issues/66))

## 🎨 Design

- **Page titles are larger, with ArrowLoop's mark before them on each tab's first page.** The first card sits closer under the title. The bottom bar names the tabs by glyph alone, so the title says where you are.
- **The bottom bar shows only glyphs unless you choose otherwise.** The words come back under Settings, Look, Bottom bar.

## ⚡ Improved

- **A job's left side can be a folder from Apps.** The folder picker on the phone offered targets only for the right side, so a folder another app shares could not be picked for the left one. Both sides offer them. ([#66](https://github.com/junkerderprovinz/arrowloop/issues/66))
- **The phone asks for the port of an SMB share.** The port was only under More settings on the web, which the phone does not have, so a share behind a forwarded port could not be set up there. It is on the first screen now, on the web too. ([#66](https://github.com/junkerderprovinz/arrowloop/issues/66))
- **Pause stops a run that is going.** It only held the schedule, so the run kept copying while the button already said Resume. Pause stops the run and holds the job until you resume it, on the web and on the phone. Run now still works on a paused job. ([#78](https://github.com/junkerderprovinz/arrowloop/issues/78))

## 🐛 Fixed

- **Targets on the internet keep working on the phone after it leaves the Wi-Fi.** The app told the engine the phone's DNS servers once, when it started. After a switch to mobile data the engine kept asking the router at home, so every target reached by name ran out after 30 seconds. The engine asks the servers of the network the phone is on, and when one of them does not answer, it tries the next one. ([#66](https://github.com/junkerderprovinz/arrowloop/issues/66))
- **Cancel the run stops a run within seconds, also over SFTP.** Once a file is across, the SFTP server works out its checksum with md5sum, which reads the whole file and cannot be interrupted, so on a large video the stop waited minutes for it. The run ends a few seconds after the stop and leaves the command to finish on its own. Until the run has ended, the button says Stopping the run. ([#78](https://github.com/junkerderprovinz/arrowloop/issues/78))
- **A stopped run is recorded as stopped.** It showed up in the history as an ordinary run with the interrupted file skipped. ([#78](https://github.com/junkerderprovinz/arrowloop/issues/78))
- **Run now shows the run straight away** on a job's page and on the Jobs page, also while the run waits for another job to finish. Until it had its turn, the page heard nothing and kept offering Run now. ([#78](https://github.com/junkerderprovinz/arrowloop/issues/78))
- **Long paths in a job's Files touched list stay on their own row.** Each row is as tall as its path needs. The list has a fixed height, which squeezed the rows to one line, so a wrapped path ran over the ones below. ([#78](https://github.com/junkerderprovinz/arrowloop/issues/78))
- **A target that could not be deleted says why on its row**, for example that a password has to be set first. The reason used to appear for a few seconds in a corner while the target stayed in the list. ([#78](https://github.com/junkerderprovinz/arrowloop/issues/78))
- **Enter starts a new line in a job's exclusions, on the web and on the phone, and in a shared list.** The field dropped an empty line as soon as Enter made one, so the cursor stayed on the last pattern. ([#78](https://github.com/junkerderprovinz/arrowloop/issues/78))
- **The Windows installer closes a running ArrowLoop and starts the new version.** It put the new program in place but left the old one running, so `/S /relaunch` only brought back the old window, and the update waited until somebody quit ArrowLoop by hand. The installer asks the running copy to quit, as Quit in the tray menu would, which lets a sync under way stop cleanly, and starts the new version once it is installed. A copy that sat in the tray comes back there, without opening its window. Coming from 2.1.0, the window opens this one time.

## 🌐 Translations

- **Every new text is in all 42 languages.**

## 2.1.0 - 2026-10-14

## ✨ Added

- **The phone app can sync the folders in Android/data**, which Android 11 and later keep from every app but the one each folder belongs to. Switch on Android/data under This phone, and they show up as a target called Android. Through root ArrowLoop reads and writes them and hands each new file to the app that owns the folder; through Shizuku it only reads them. You pick root or Shizuku yourself, and a way the phone cannot offer is dimmed, with a line that says why. The su command field takes the name or path of su for root managers that rename or move it, Request root brings up the root manager's prompt again, Ask Shizuku asks Shizuku for access, and Get Shizuku opens its download page while it is not installed.

## 🎨 Design

- **The phone's Appearance card puts Labels and Bottom bar before the colours.** Colour Rotation and the colour palette appear only while Rainbow Mode is on, instead of standing there dimmed.
- **Global sync settings is one wide button** on the phone's Sync card, in place of a row with an Open button.
- **The store shows eight screenshots instead of six**, now with the Overview and Conflicts, and the store and README pictures show the 2.0 interface.

## ⚡ Improved

- **The phone app leaves the notification services to the server and the desktop.** Global sync settings on the phone no longer shows Matrix, email, Apprise, Healthchecks.io or the webhook, and the phone tells you about runs through Android's own notifications. A channel set up there before sends nothing from the phone, but its settings stay in the configuration untouched. The hint under Report a held job says the message comes as a notification on this phone.

## 🐛 Fixed

- **The first job card on the Jobs page shows its whole badge.** The card comes after its name button, so the rule that leaves room above the first card never reached it, and the badge was cut off at the top of the page.
- **A running job's card on the phone shows its progress bar.** The bar's track took no width in the card's column, so the fill had nothing to fill.
- **The phone app builds with JDK 17 to 21.** The build accepted only JDK 17, and F-Droid's build server runs Java 21. JDKs past 21 are still turned away, since React Native's CMake step fails on them.

## 🌐 Translations

- **Every new text is in all 42 languages.**

## 2.0.0 - 2026-10-13

## ✨ Added

- **The settings tiles can go in an order of your own.** Hold a tile, or drag it with the mouse, and move it along the column; Alt and an arrow key move the tile that has the focus. This browser keeps the order, and Reset under Look puts it back.
- **A new install opens on a welcome page** that says what ArrowLoop found and lists three steps to the first sync. Restore settings brings back the jobs from a backup file.
- **After an update, green dots mark what changed.** A click hides a dot. New in the Version card on the Info tile opens one window with two tabs, the notes of the running version and the list of changes: on the changes while something is unseen, on the notes after that. New counts what you have not seen, and one button at the top of the list marks everything as seen or shows it all again. After the next update the window opens by itself on the release notes. A browser that never had an older version open starts with every change seen.
- **The Info tile** shows the versions of ArrowLoop, GlimStone and rclone, each linked to its release, and checks GitHub for a newer one. It links to the manual and downloads a bug report: one file with the versions, the settings and jobs without passwords or keys, the last 100 runs and the open anomalies. Nothing is sent.
- **The anomaly notes can be switched off.** The switch sits in the Anomalies card on Safety net, beside its settings. Off, the Anomalies page leaves the sidebar and the phone, and no note about a failing or overdue job is made. The brakes keep holding, and a held job is answered on its own page.
- **ArrowLoop learns what a job's runs usually do and notes a run far outside it.** From a job's last fifty successful runs it learns how many files a run deletes and copies and how long it takes, and once a job has ten runs behind it, a run far past the usual (six median deviations and a floor of its own) gets a note such as Files deleted: 412, usually 0 to 6. The note holds nothing and closes with the next usual run. Rings on the Anomalies page show how far each job has learned, the job's page shows its usual ranges, and Report unusual runs on Safety net switches it off.
- **Notifications go to more places, as in BombVault.** Beside Matrix, a webhook speaks plain JSON, Discord, Slack, Gotify or ntfy, and ArrowLoop sends email, posts to an Apprise API server you run and pings Healthchecks.io when a run starts and ends, with a check of its own per job if you want one. Send a message chooses Never, When a run fails or After every run, every channel has a switch that turns it off and keeps its settings, and Send a test tries one channel and says why it failed. Passwords, tokens and addresses with a key in them stay on the server and never reach the log. The phone has the same channels under Global sync settings. A configuration with a Matrix room and a webhook keeps working as it is. Unraid's own notifications are not offered, since a container cannot run Unraid's notify script; see the manual.
- **A job's own brakes are set on its page**, in the Brakes card, on the web and in the phone's job screen.
- **The Apps tile offers the phone app on F-Droid**, and the Help card's manual button is the README's own, its book opening under the pointer, on focus and under a finger.
- **The phone app has a bar with Overview, Jobs, Conflicts, History and More**, and More holds Anomalies, Trash, Targets and Settings.
- **The phone opens on a new Overview.** Tiles count the open conflicts, the findings and the trash and lead to them. Below them stand the running jobs with their direction, progress and up to three files at work, the next scheduled runs, the last run with its changes, and how full each target is. Without file access, a notice above the tiles leads to the setting that grants it. With no jobs yet, it offers to add the first one.
- **The phone's settings are one column in a fixed order.** A Synchronisation card under the language shows the default direction and schedule and opens the Sync page. This phone gathers file access, notifications, background activity and the lock. Problems? copies a short report without paths, names or addresses, and the Danger zone removes every job and storage location while the files stay where they are.

## 🎨 Design

- **ArrowLoop follows GlimStone 3.5.** Warnings are orange, text comes in five sizes, a pressed button gives way a little, and Design offers System beside Dark and Light. Settings pages use the whole width of the window, and a one-line field or a dropdown stands beside its name, as a switch does, on Settings, in the Security cards, in the job editor and in the forms for a target and a drive. In the schedule editor the boxes stand at the end of their rows too. On the phone a number or a time stands beside its name, and a choice whose segments do not fit there, such as Mode or the kind of schedule, becomes a dropdown. In the job editor the state file moves below the two sides, since it is the field changed least.
- **The sidebar holds Jobs, Conflicts, Anomalies, Trash and History.** Sign out sits above Settings once a password is set. Targets is a tile under Settings, and Also show in the sidebar puts it back; while it is there, the tile shows only that switch, how many targets and drives are saved, and Open. Every page has an address of its own, and an old one leads to where the page is now.
- **Settings is a column of eight tiles: General, Look, Sync, Safety net, Targets, Security, Apps and Info.** Each tile shows all its cards one under the other, and below 1024 pixels the tiles show only their glyphs. Below 768 pixels and in a phone's browser they stand in a strip above the cards, which then get the whole width; the open tile shows its name and the others their glyph. What Engine held is now under General, Sync and Safety net, and App is called Apps. A search comes up when you scroll up once more at the top of a page, or with / or Ctrl+K, and it finds the old names too. The selectors in Settings are as low as a field and take the width of their row, and a tile is no taller than one of BombVault's.
- **Every job is a card of its own.** On the left it shows the job's sides and when it runs; on the right its last fourteen runs stand as a strip with its one status right after it, and More, Pause and Run now under them. The two halves are centred on each other. More holds everything else the job's page offers, Edit, Duplicate, Preview, Check this job, Find duplicates, Open this job's trash and Remove, so a job need not be opened first; on the phone it holds Open, Edit, Duplicate, Preview, Check this job, the trash of either side and Delete. A held run, a waiting conflict or a note shows in orange and is never shown as synced. A click on the card opens the job.
- **Every job has a page of its own**, with a back button to the jobs, its runs, the files it touched, the preview, the check, the duplicate search and its brakes, each in a card. The job editor opens in a window, and Files touched has no search of its own, since History searches across every job.
- **Every finding on Anomalies is a card of its own**, as in BombVault: what happened, since when and its answers, Run anyway, Take back, Acknowledge and Open job. Every card starts at the same height, and Show more opens the figures, the engine's words and the files a brake counted (the first ten, then how many more) in place. Nothing opens over the page, on the web or on the phone. The tiles that count the findings are as tall as BombVault's and say how many are open. The card listing jobs with nothing open is gone.
- **Every conflict says what it is about.** It names the file with its full path, says in one sentence whether both sides changed it since the last sync or it turned up on both sides before they were ever synced, and shows for each side the size, the time of the last change spelled out, which version is newer and the name it sits under now. The answers say what they do: Keep both files, Keep the left version, trash the right, and on the phone Keep the version on this phone, trash the other. The answer for all of them only appears from two conflicts up.
- **History has Filter and Search in its card, beside Files and Runs. Conflicts, Trash and Anomalies have none**, since a card per job says enough; a link from a job's page narrows them to that job, shown as a chip that undoes it. Runs open in a window instead of folding out, and in a narrow window that window comes up from the bottom.
- **Empty the trash is the filled button in the Trash corner, and Delete old entries stands beside it** as a button of its own. A More menu that would hold one action is now that action's button, on the web and on the phone.
- **Connect storage and clouds and Register a drive float at the bottom right of the window** on the Targets tile too, in the same place as Add a job on Jobs, instead of standing a little higher than on the other pages.
- **A narrow window gets a bar along the bottom** with Jobs, Conflicts, History, Settings and More.
- **Every card is titled with a noun for what it holds.** What gets carried is now Contents and Back up your settings is Settings backup; a job's page has Check, Duplicates, Held run and Usual run. On the phone The connection became Network and After a failure became Retries. The settings search still finds the old names and opens the card.
- **A job shows each setting it takes from the global sync settings with the value in force, locked.** Override gives the job a value of its own, starting from the one it had, and Use the default gives it back after asking. This replaces Use the global sync settings, which switched five settings at once and hid what they were set to. A job's brakes work the same way, on the web and on the phone.
- **Exceptions on the Sync tile lists the jobs with values of their own**, each with those values and Use the default, and is not there while every job follows the defaults. Safety net has the same card for brakes, and the phone shows it under Global sync settings.
- **A schedule reads as a sentence on a button**, such as Daily at 03:00, and a click opens its editor beside it, on the phone in a sheet. The default schedule on Sync works the same way instead of being a raw cron field, and Cron in the editor still takes an expression typed by hand.

## ⚡ Improved

- **The phone's overview names the sides in the last run's changes** the way the history does: Copied to music-b and Deleted in music-a between two folders or two targets, and Uploaded to or Deleted locally only where one side is a target and the other is not. Until a run reports its first progress, the line under its bar says it is starting and comparing both sides, on the phone and on the job's page, where it used to borrow the preview's sentence.
- **Every kind of storage rclone ships has a name and a group in Connect storage and clouds**, which was called Add storage or cloud. The 21 that stood at the end under their rclone names are sorted in: 1Fichier, Drime, Enterprise File Fabric, FileLu, premiumize.me and Shade under Clouds, Azure Files, ImageKit, QingStor, Sia and Tardigrade under Object storage, and DOI with the kinds built on another target (Alias, Archive files, Cache, Checksums, Combined targets, Compressed, In memory, Merged targets, Split into pieces) under Servers & shares. Logos come from Dashboard Icons (premiumize.me), Simple Icons (DOI) and the brands' own sites and repositories (1Fichier, Drime, FileLu, ImageKit, Shade, Sia and QingCloud's mark for QingStor); Azure Files and Tardigrade wear Azure's and Storj's marks. Every field of the form has a name in plain words, and its (i) ends with rclone's own name for it.
- **Connect storage and clouds has a search at the top right.** It narrows all three groups as you type, by the name shown or by rclone's own name, and ignores accents, so uloz finds Ulož.to. Escape empties it. The phone's target picker has the same search.
- **A target's Test connection button shows its own answer**: green with Connected, or red with Not connected and the reason under the name, in your language where ArrowLoop knows the failure. The separate badge beside the name is gone.
- **A stored password, key or token shows as Saved with Change** in a target's form, on the web and on the phone, as the notification secrets do. The field only appears while you change it, and saving without touching it keeps what is stored.
- **A failed run says why in your language.** Finding cards, run rows, the run window, the tray's list and the phone say the failures the engine knows in words, with the figures written your way: "Am Ziel (rechts) sind 16 KB frei, dieser Auftrag würde mindestens 29 GB schreiben." That covers a destination too full, a drive not plugged in, a server that does not answer, a refused sign-in, denied access, a missing folder, a full quota, a service asking for a pause, a stopped run and a failed command before or after the run. Anything else shows the engine's English under The engine reported:. Trash and Conflicts say the same way why a side or a job could not be read. The phone's notification about a failed run says it in English or German.
- **The backup card says what its buttons do to everything.** Its rows read Back up all jobs and all settings and Restore all jobs and all settings, on the web and on the phone, and the phone asks before a restore as the web does.
- **Forgot password? is a full-width button at the foot of the login**, and the reset form appears once the code is in the log. The code field's (i) says where the log is, how long the code lasts and who else can read it. The new password is typed twice. A refused code is wrong or has expired, and the log gets a new one only when Forgot password? is pressed again after the ten minutes. The page after the reset lists what it removed and points to Settings, Security.
- **The phone's Docker button swells once when its command is copied**, as Copy report does.
- **A target shows how full it is as a bar under its name** once it is connected. Its end sloshes, as does the phone's bar, as lively as the motion setting allows and still at Off or when the system asks for less motion.
- **Ctrl+F opens History's search.** Escape empties it, and a second Escape turns it back into the button.
- **The passkey card names the certificate** when a host name is served over a connection the browser does not trust.
- **The phone's job editor has three cards instead of one per setting**: the job, its runs and what gets carried. A refused Save shakes, says why under the field it concerns and scrolls there.
- **Windows keep Tab inside, close on Escape and give the focus back** to the button that opened them, confirmations included, and a job card opens from the keyboard through a button with its name.
- **Every control on the phone answers a press.** It dims while a finger holds it and gives way a little, selector segments and the floating button included.
- **On the phone, dropdowns and card menus open inside the screen in right-to-left languages.**

## 🐛 Fixed

- **Two accounts on one server are two places.** A job between two Nextcloud users, or between two access keys on one S3 endpoint, looked like a job pointing at itself, and ArrowLoop refused to start. A job whose two sides really are one place now stops alone and says why in its history, while the other jobs keep running.
- **A job that sets its own direction no longer takes the default's mode.** With mirror as the default, a job set to run right to left mirrored that way too, and a job set to mirror changed sides when the default direction changed. Direction and mode now go together, as the editor shows them: a job with a direction and no mode copies, and a mirror or move without a direction of its own stops and says it needs one.
- **A watched folder deleted and made again, or a stick plugged back under the same letter, is watched again** from the next minute. Until then the job ran only on its schedule.
- **A held run you allow is no unusual run.** Run anyway and Take back no longer leave a note about the deletions you just allowed, and the job does not learn from that run what it usually does.
- **Healthchecks.io hears nothing while a job's drive is unplugged**, also for a job with a command before the run. Such a job reported a failed run at every turn.
- **A job whose schedule was missed no longer makes the page ask for the findings without end.** Reading the findings confirmed the overdue note, the engine reported that as a change, and the page read the findings again, tens of thousands of times until the browser gave up or the job ran. The engine now reports only a real change, and the page asks at most once a second.
- **The duplicate search names its sides in whole words.** German read "linksn Seite", and several other languages declined the side word wrongly.
- **Enterprise File Fabric no longer wears Nasuni's mark.** Its own logo is gone, so the target picker shows the storage glyph.
- **A control carries one What's new dot.** On a narrow screen a changed strip and the link inside it, such as the bottom bar and More, each drew one on the same corner.
- **The file log and the run list no longer cut their words.** A long kind such as "Conflict, both versions kept" and a long path wrap instead.
- **Two folders with the same name are told apart.** Two folders called Musik both read as Musik, so the last changes said "Copied to Musik" twice; they now go by as many parent folders as it takes, such as "Handy/Musik" and "Ablage/Musik".
- **A job set to run only when asked stays that way when a default schedule is set.** Its empty schedule was taken as no schedule at all, so the default ran it on the clock. A job without a schedule of its own still follows the default.
- **The Cron field keeps the spaces you type**, and switching to Cron writes out the schedule already set instead of an empty field.
- **Overdue after says what it counts.** The setting was called Days without a run, which read wrong for a job that runs once a week. It counts the days from the scheduled run that was missed, and its (i) gives the weekly example.
- **A saved Matrix token or mail password goes only to the server it was saved for.** After changing the server, type it again. Send a test needs a password when the engine listens on the network, and a failed test names only the status the server answered.
- **Notifications and Healthchecks pings leave out passwords from a run's error**, as the bug report does: the parameters of a connection string such as `:sftp,host=...,pass=...:` and what a failed command before or after the run printed.
- **The bug report says only whether a mail address, a mail server or a Matrix room is set**, instead of naming them.

## 🌐 Translations

- **Every new text is in all 42 languages**, the failure reasons and the What's new list included.

## 1.9.0 - 2026-10-13

## ✨ Added

- **A job that missed its turn because its drive was away runs once the drive is back.** On a computer or in a container it used to wait for the next scheduled turn. Now it runs within a minute of the drive coming back, if a turn passed meanwhile, and a job that watches for changes starts watching the drive again. The phone already caught up at its next wake-up.
- **Groundwork for Android/data.** `arrowloop serve-data`, started as root or from the adb shell, opens the per-app folders Android keeps from other apps and hands them to the engine as a target called Android. As root it gives each new file to the app whose folder it lands in; from the adb shell it only reads. The phone app does not start it yet.

## ⚡ Improved

- **A reset code goes into the log once per ten minutes.** Asking again while a code is valid writes nothing, so the log does not fill up and the code you are typing stays good. The code stands on its own between the other lines, in yellow, and wrong codes show up in the log as a count at most once a minute.
- **A password reset or change ends whatever was under way.** A passkey being registered, a second factor being set up or a sign-in that started before the reset no longer survives it.

## 🐛 Fixed

- **A locked-out address can no longer keep guessing the reset code.** After five wrong codes the address waits a minute before any code is checked, the right one included. Behind a reverse proxy without `ARROWLOOP_TRUSTED_PROXIES` that wait applies to everyone, you as well.
- **Secrets stay on the server whatever case the configuration file spells its keys in.** The Matrix token, the webhook address and a job's commands reached the settings page when the file said `Notify` or `Jobs` instead of `notify` or `jobs`.
- **Forgetting a job's state is refused while another job's record cannot be checked**, for example on a share that is not mounted, since it might be the same file.
- **On Windows a change made just as a job starts watching is no longer missed.** Windows records changes for a folder only from the moment it is first asked, so a file saved in that instant waited for the next change or the next scheduled run.

## 1.8.0 - 2026-10-11

## ✨ Added

- **A forgotten password can be reset with a code from the log.** Forgot the password? on the login page has ArrowLoop write a one-time code into its log, valid for ten minutes. The new password takes two-factor authentication, every passkey and every other session with it, and the page lists what went. Whoever can read the container's log can do this, which the installation guide spells out; a password from `ARROWLOOP_PASSWORD_HASH` is not reset this way.

## ⚡ Improved

- **Every install has a key of its own.** It comes from `ARROWLOOP_APP_KEY`, or is drawn once into `app.key` beside the configuration. The password is stored as Argon2id peppered with it, and the authenticator secret is sealed with it, so a copy of `security.json` alone opens nothing. A password stored the older way works as before and is stored again the new way at the next login.
- **Without a password, a container refuses what a stranger on the network should never do.** Downloading or restoring the settings backup, deleting from the trash for good, forgetting a job's state and deleting a target answer that a password has to be set first. The phone app and the desktop window are not asked.
- **The Matrix token and the webhook address stay on the server.** The settings show them as dots, and saving without touching them keeps them.
- **Emptying or pruning the trash takes exactly what was shown.** A file binned after the confirmation came up stops the emptying instead of going with it.
- **A change has to arrive as JSON.** A page on another site can send a form to the port without the browser asking first; that is refused. A script that starts a run with curl adds `-H 'Content-Type: application/json'`.
- **An older ArrowLoop refuses data a newer one wrote**, for the run history, the job records and the login settings, instead of misreading them.

## 🐛 Fixed

- **A run cut off by quitting, a restart or a crash no longer vanishes from the history.** Quitting ArrowLoop stops a running job and waits until the run is recorded. When the program is killed instead, the run shows up at the next start as interrupted, with everything it had done. The files it finished stay settled, so the next run picks up where it ended.
- **Two changes to the password at once can no longer both win.** A change is written only if the password is still the one that was checked.
- **A flood of addresses can no longer lift a login lockout.** When the table of failed logins is full, the addresses that are not locked out go first.
- **A job whose two sides are one folder is refused also when the folder is reached through a symlink or spelled in another case.** Forgetting a job's state is refused when another job keeps its record in the same file.
- **`arrowloop hash-password` takes `-config`**, since the hash is made under that install's key, and refuses where no configuration is found.

## 1.7.0 - 2026-10-11

## ✨ Added

- **A run a safety brake refuses holds its job, and the app asks what to do.** Until now the run failed, the retries repeated it, and nothing let it through short of switching the brake off. The job is listed under Anomalies with the figures and the files the brake counted. Run anyway lets exactly that change through; if more has happened since, the job is held again with the new figures. Take back undoes the change where it was made: files one side lost are copied back from the other, and nothing is deleted. A finding whose cause goes away, such as a share that was not mounted, closes by itself.
- **A second brake holds a run that would overwrite most of the files.** That is what a folder looks like after something encrypted it in place. It is fifty percent by default, like the mass-delete brake, and shares its floor. A run that overwrites in bulk on your word keeps the content it replaces as a version, even on a job that keeps none.
- **Two notes say a job keeps failing or has missed its schedule.** Three failed runs in a row make the first, two days without a scheduled run the second. Neither holds anything, and an acknowledged note stays away until its cause has gone and come back.
- **A held job is reported.** The desktop app shows a notification of the system, the phone posts one on a channel of its own, and Matrix and the webhook get the message where they are set up. The notes are reported only when that is switched on.
- **Each job can have its own brakes.** They are set under Monitoring on the job's card on the Anomalies page, for a download folder that is emptied often or an archive where nothing should ever go.
- **A job can sync into one folder on a drive, picked rather than typed.** In the folder picker a plugged-in drive opens like any folder, and a new folder can be made on it. The job keeps the drive's identity, so it finds the folder again after the drive comes back under another letter.

## 🎨 Design

- **The phone's overview card for what waits is called Action centre** and lists the anomalies beside the conflicts and the bin.
- **The desktop app's notification has a sound of its own.** An arrow that whizzes in and hits a metal shield, made for ArrowLoop. Windows lets an installed program's notification play only its built-in sounds, so there the notification stays silent and ArrowLoop plays the sound itself, unless do not disturb is on or its notifications are switched off. On Linux the notification asks for the warning sound of the desktop's sound theme.
- **Adding a drive shows the name the system gives it.** The list reads "F:\ · Samsung T7" instead of just the letter, and that name fills the name field until you type your own.
- **The activity window's badge says only what happened to a file.** Replaced, Copied, Moved, Deleted and the like, without the folder: the paths underneath say where, and with a music folder synced into another music folder the folder's name told nothing.
- **ArrowLoop's own folder is hidden on Windows.** The `.arrowloop` folder that holds the bin and the kept versions gets the hidden attribute on every side that is a folder, a drive or a share, also where it is already there. On macOS and Linux its leading dot already hides it.
- **The file list under History says only what happened, too.** Replaced, Copied, Deleted and the like, as in the activity window; the arrow and the path beside it say where.
- **A job's card names a drive by its label.** A side on a registered drive read as `volume:` and a long identity; it reads as the drive's name and the folder on it, such as "externe_festplatte/opencloud".

## 🐛 Fixed

- **A folder kept by a cloud client that fetches files on demand is synced on Windows.** OpenCloud, OneDrive and Nextcloud mark such folders in a way that the engine took for a junction, so a job over them copied nothing from inside them and reported them as left out. They are ordinary folders again, and a real junction is still left alone and reported as a link. Files the client has not downloaded yet are fetched by it while the job reads them.

## 1.6.0 - 2026-10-03

## 🎨 Design

- **The download buttons name the system first.** The ARM64 builds read Windows or Linux over ARM64, in the App tab and in the phone app, like the x64 builds beside them.
- **The README shows the Android app as wide as the desktop app and the container,** with three phones in front of the clouds and servers ArrowLoop syncs with.
- **The Save button has a new floppy.** It is Material Design Icons' `content-save` (Apache 2.0), the same drawing GlimStone 3.1.6 uses. The old one came from Vecteezy under a licence that is not open, which F-Droid counts as a non-free asset.
- **The README's download buttons come in groups.** The server comes first, then the desktop apps, then the Android app, with more room between the groups. The screenshots are in the same order.
- **How it compares is back in the README.** The table that sets ArrowLoop against GoodSync, FreeFileSync, Syncthing and five other tools sits between What it does and Getting started.
- **The phone app draws a job's direction as arrows between its two folders.** The job form stacks the two sides, so "only to the right" and "only to the left" meant nothing there. The switch sits between the two folder fields with an arrow down, an arrow up and one for both ways, and a line under it names the side files come from and the side they go to. The job list and the global sync settings use the same arrows.
- **The phone app calls a side by its name.** The trash, the conflicts and the reading stage on the overview said left and right, like the direction did. They now say "On the device" or the target's name, and two folders on the device go by their last folder. A file in transfer shows an upload or a download mark instead of an arrow to the side, and the history drops the arrow, since each row already names the place.
- **One answer for several conflicts names a side only when they share it.** If the chosen conflicts come from jobs with different sides, the phone offers "Keep both" for all of them and leaves the rest to each card.

## ⚡ Improved

- **The Unraid buttons lead to ArrowLoop's entry in Community Applications.** In the App tab and in the phone app they said it was coming; the README has an Unraid button of its own, and the installation guide starts with the entry.
- **The phone app has a Save button for a new job.** Before, the form wrote the job as soon as it had a name and both sides, so it could start running before you had set its direction and schedule. A new job is written when you press Save, and Cancel leaves without one. An existing job still saves each change as you make it.

## 🐛 Fixed

- **Taking a job off the global sync settings on the phone keeps what it ran with.** The form used to reset it to both ways, sync and no schedule instead of starting from the global values.
- **A timed run on the phone waits when Android has cut the app off the network.** Android 16 takes the network from an app without the battery exemption a few seconds after it leaves the screen, while the engine keeps running for a while. A run its clock started in that time failed on the first lookup with "operation not permitted". Such a run is held and goes with the next wake-up, at most fifteen minutes later, when Android lets the app onto the network again. With battery optimisation switched off for ArrowLoop, as the settings suggest, runs stay on time.
- **A run started by hand on the phone keeps its network after the app is left.** Android 16 blocks an app without the battery exemption a few seconds after it leaves the screen, so a run that took longer than that lost its connection. A run in progress moves into the foreground service as the app goes away, shown by the ArrowLoop notification, and the service ends with the run.
- **Android's own bin is left out of a sync.** A file deleted in Android's file manager stays in its folder for thirty days under a name starting with `.trashed-`, and a download still being written starts with `.pending-`. Both were synced like any file, so emptying the bin on the phone looked like a mass deletion and tripped the brake. They are excluded by default, like the half-written files of other programs.
- **The number fields of the phone's sync settings can be emptied to type a new value.** The mass-delete brake, the files at once and the retry fields refilled themselves with the default the moment the last digit was deleted.

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
