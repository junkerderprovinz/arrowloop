# Privacy policy: ArrowLoop

Last updated: 25 September 2026. Applies to the ArrowLoop Android app, the
desktop app and the container, from version 1.1.0, until this date changes.

## The short version

ArrowLoop copies your files between the places you set up, and only there. It
has no analytics, no advertising, no accounts, no crash reporting and no
tracking. Nothing about you or your files is sent to us, and we run no server
that it talks to.

## What is stored on your device

Everything below stays on the device ArrowLoop runs on. On Android it is kept in
the app's private storage, which other apps cannot read, and it is left out of
Android's cloud backup. Uninstalling the app removes all of it.

- Your jobs: which folders are synced with which destination, when, and with
  which rules.
- Your storage targets and their access details (server addresses, user names,
  passwords, tokens or keys), in an rclone configuration file. rclone obscures
  the passwords in that file, which hides them from a glance but is not
  encryption.
- The record of each synced file that lets ArrowLoop tell a change from a
  deletion, and the history of runs: when a job ran, what it copied, deleted or
  skipped, and why.
- Settings: language, appearance, notifications and the phone conditions a job
  waits for (Wi-Fi, no roaming, an unmetered network, charging, battery level).
- An interface password, if you set one, kept only as a hash.

A settings backup you export yourself is written to the Downloads folder. It
holds your jobs and settings, but neither the targets' access details nor the
password.

## What leaves your device

Only what you set up, and only to where you point it:

- **Your files**, to and from the storage targets you add: cloud storage, an
  SFTP, WebDAV or SMB server, another folder, whatever the job names. The
  provider of that storage handles your files under its own terms.
- **Notifications**, if you add a Matrix room or a webhook: a short report on a
  run goes to that address. It holds the job's name, whether it succeeded, how
  many files were copied, moved or deleted, an error message if there was one,
  and the paths of up to five files left for the next run.
- **Links you tap**, such as the source code or a donation page, open in your
  browser, which then connects to that site.

On Android the app's own engine listens on 127.0.0.1 only, so no other device on
your network can reach it.

## Permissions (Android)

- **All files access**, so a job can sync any folder you choose, such as DCIM,
  Documents or a folder another app writes to. ArrowLoop reads and writes only
  the folders your jobs name.
- **Notifications**, to show a running sync and to report a failed one.
- **Foreground service (data sync)**, so a transfer can finish while the app is
  in the background, with its progress in the notification.
- **Run at startup**, so scheduled jobs resume after the phone restarts.
- **Network access and network state**, to reach your storage targets and to
  hold a job until the phone is on Wi-Fi when you ask for that.

## What ArrowLoop does not do

- It does not upload anything to us, and it contains no third-party SDK that
  does.
- It does not read folders that no job names.
- It does not sell, share or use any data for advertising.

## Your choices and your data

Everything ArrowLoop knows about you is in the files listed above, on your own
device. You can see and change it in the app, export it, or delete it by
removing a job or a target or by uninstalling the app. As we hold no data about
you, there is nothing for us to hand over or delete.

## Who is responsible

Georg Düringer (Halleluja Design)
privacy@halleluja.design

## Children

ArrowLoop is a tool for managing files and is not directed at children.

## Changes

A change to this policy is published here, with a new date at the top, and
listed in the release notes of the version it applies to.

## Source

ArrowLoop is open source, so every statement here can be checked against the
code: <https://github.com/junkerderprovinz/arrowloop>
