# Google Play submission: ArrowLoop for Android

What Play Console asks for when the app is listed, in the order its dashboard
asks for it. The listing texts and graphics are in `metadata/android/<lang>/`,
in fastlane's layout, so a later upload can read them from here.

## Before submitting

1. **Release.** A `vX.Y.Z` tag builds the app bundle Play takes. It is not a
   file on the release page but an artifact of the release run, named
   `arrowloop-play` (`arrowloop-play.aab`), kept for 90 days. Its versionCode is
   `major * 10000 + minor * 100 + patch`, so 1.1.0 is 10100, and every upload
   needs a higher one than the last.
2. **The bundle is signed with the release key**, the one the APKs on the
   release page carry (SHA-256 `13477be4...10e6`, checked by the build).
3. **The privacy policy** is `PRIVACY.md` on `main`:
   <https://github.com/junkerderprovinz/arrowloop/blob/main/PRIVACY.md>

## Create the app

- App name: ArrowLoop
- Default language: English (United States), with German (Germany) added as a
  translation of the listing
- App or game: App. Free or paid: Free.

## Play App Signing

Play signs what it delivers with an app signing key. Two ways:

- **Upload the release key as the app signing key** ("Use a different key",
  with Google's PEPK tool). The Play build and the APK from GitHub then carry
  the same signature, so somebody can move between the two without
  uninstalling. This needs the keystore file itself, not only the GitHub
  secrets.
- **Let Google generate the app signing key** and keep the release key as the
  upload key. Simpler, but a phone that has the GitHub APK installed has to
  uninstall it before it can install from Play, and the other way round.

## Store listing

- Title, short and full description: `metadata/android/<lang>/*.txt`
- App icon: `metadata/android/<lang>/images/icon.png` (512x512)
- Feature graphic: `metadata/android/<lang>/images/featureGraphic.png` (1024x500)
- Phone screenshots: `metadata/android/<lang>/images/phoneScreenshots/`
- Category: Tools. Tags: file sync, backup.
- Contact email: privacy@halleluja.design. Website:
  <https://github.com/junkerderprovinz/arrowloop>

## App content

**Privacy policy:** the URL above.

**App access:** "All functionality is available without special access." The
app has no account. A job needs two folders, and both can be on the phone, so
a reviewer needs no server.

Reviewer notes, to paste into the instructions field:

> ArrowLoop syncs two folders. To try it without a server: grant "All files
> access" when asked, open Jobs, add a job, pick a folder on the phone for each
> side (for example Documents and a new folder "ArrowLoop test"), put a file in
> one of them and tap Run. The file appears on the other side, and the run is
> listed in History. Deleting it on one side moves it to the trash folder
> `.arrowloop/trash` on the other at the next run.

**Ads:** No.

**Content rating:** questionnaire category "Utility, productivity,
communication or other". Every question is answered No: no violence, sexual
content, language, controlled substances or gambling, no user-to-user
interaction or sharing inside the app, no location sharing, no purchases.

**Target audience:** 18 and over. The app is not directed at children.

**News app:** No. **Health, financial, government:** No.

**Data safety.** Google counts data as collected when an app sends it off the
device, and the files a job syncs leave the phone for the destination the user
picks. Declared that way, nothing is shared, because the user starts every
transfer and chooses where it goes:

- Does the app collect or share any of the required data types: Yes
- Files and docs: collected, not shared. Purpose: app functionality. Required
  (a sync app cannot work without it). Not processed ephemerally.
- Every other data type: not collected. There are no analytics, crash reports,
  identifiers or location.
- Is all data encrypted in transit: No. The user chooses the protocol, and SMB,
  plain WebDAV and FTP are not encrypted.
- Can users ask for their data to be deleted: the data is on the user's own
  device and storage, and we hold none; answer that no data is kept by the
  developer.

**Permissions declarations:**

- **All files access** (`MANAGE_EXTERNAL_STORAGE`). Use case: file sync and
  backup. Text:

  > ArrowLoop synchronises folders on the phone with the user's own storage
  > (a NAS, a server over SFTP, SMB or WebDAV, or cloud storage), in both
  > directions. The user picks which folders take part, and these are often
  > shared folders written by other apps, such as DCIM, Documents or Download,
  > which the Storage Access Framework cannot keep in sync reliably in the
  > background. ArrowLoop reads and writes only the folders a job names.

- **Foreground service, data sync** (`FOREGROUND_SERVICE_DATA_SYNC`). Text:

  > A sync job copies files between the phone and the user's storage. The
  > foreground service keeps the transfer alive until it finishes and shows its
  > progress in a notification. It starts only when a job runs: on a schedule
  > the user set, when a watched folder changes, or when the user taps Run.

  Play asks for a video link showing the feature: record the phone screen
  while tapping Run on a job, pulling down the notification shade to show the
  running sync, and waiting for it to finish. Upload it as an unlisted YouTube
  video.

## Release

- A new personal developer account has to run a **closed test** with at least
  12 testers who stay opted in for 14 days before it can apply for production.
  Create the closed testing track, add the testers' Google accounts (or a Google
  Group), upload the bundle there, and send them the opt-in link.
- Countries: all.
- Release notes: the release's `.github/release-notes/vX.Y.Z.md`, cut to 500
  characters per language.
- After the 14 days: apply for production access in the dashboard, then promote
  the release. Once the listing is live, set its address as `PLAY_STORE` in
  `web/src/pages/Apps.tsx` and `scripts/gen_download_buttons.py`, and run the
  button generator, so the App tab and the README link to it.
