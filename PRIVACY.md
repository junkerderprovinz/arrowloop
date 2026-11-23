# Privacy policy: ArrowLoop

Last updated: 24 November 2026. Applies to the ArrowLoop Android app, the
desktop app and the container, from version 1.1.0, until this date changes.

## The short version

ArrowLoop copies your files between the places you set up, and only there. It
has no analytics, no advertising, no accounts, no crash reporting and no
tracking. Nothing about you or your files is sent to us. The one server we run
that it can talk to is the relay that pairs your instances, and only once you
pair them.

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
- The VPNs you set up, in `vpn.json` beside the configuration: each VPN's
  provider, its location, the Wi-Fi networks where its jobs go direct, and its
  login. The login is what you entered (a WireGuard configuration with its
  private key and the server's address, or a user name, password, account
  number or token) plus any key ArrowLoop registered with the provider. It is
  encrypted with this install's key, and the interface never shows it again. A
  settings backup leaves the file out.
- If you pair your instances: the secret behind the twelve words and this
  instance's own key, both encrypted, and the instances approved in the group
  with when they were last seen.

A settings backup you export yourself is written to the Downloads folder. It
holds your jobs and settings, but neither the targets' access details nor the
password.

## What leaves your device

Only what you set up, and only to where you point it:

- **Your files**, to and from the storage targets you add: cloud storage, an
  SFTP, WebDAV or SMB server, another folder, whatever the job names. The
  provider of that storage handles your files under its own terms.
- **Notifications**, if you add a channel such as Discord, Slack, ntfy,
  Gotify, Matrix, mail, Apprise, Shoutrrr, a webhook or Healthchecks.io: a
  short report on a run goes to that address. It holds the job's name,
  whether it succeeded, how many files were copied, moved or deleted, an error
  message if there was one, and the paths of up to five files left for the
  next run.
- **Pairing**, if you pair your instances: they reach each other through a
  relay, ParleyPort, which we run at parleyport.halleluja.design unless you
  choose a relay of your own or none, and directly when they are on the same
  network. What your instances send each other (the job list, a job's settings
  when another instance opens or saves it, the folder names its folder picker
  shows, and the request to start or stop a job) is encrypted end to end
  with a key made from your twelve words, which never leave your instances.
  The relay sees which instance a message is for, how big it is, when it
  arrives and the IP addresses of your instances, keeps none of it, and stores
  nothing. A container or server that is paired announces itself on your own
  network so the others find it there.
- **The fortress**, if ArrowLoop joins one: your other apps in it see
  how ArrowLoop is doing and its run log, and, where you leave the permission
  on, list, start or add a job, see the targets a new job could write to,
  fetch a backup of the settings with each job's state, or put one back.
  These travel the same way as pairing, encrypted end to end with a key made
  from the fortress's phrase.
- **Dashboards and scripts**, if you make an API token: whatever holds a token
  that reads the status and log can read how ArrowLoop is doing and its run
  log, and nothing else. A token for everything opens the whole interface.
- **A sign-in service**, if you set one up, such as Pocket ID or authentik.
  When you sign in through it, your browser goes there and back, and
  ArrowLoop asks the service who you are: your name there, your email
  address if it sends one, and its groups for you. ArrowLoop keeps the name,
  the groups and the service's ID for you with your account in `signin.json`.
- **The built-in VPN**, if a job names one. While that job runs, its
  connections go through a WireGuard tunnel to your provider's server or your
  own, and the rest of ArrowLoop keeps to your normal connection. With
  NordVPN, Private Internet Access, Mullvad, hide.me, TorGuard, AzireVPN and
  Obscura, ArrowLoop signs in with your login to pick a server and to fetch or
  register the WireGuard key. Mullvad, AzireVPN and Obscura get their key back
  when you remove the VPN. If you leave the location empty, ArrowLoop asks
  Mullvad where the request comes from, to find the nearest server. **Test**
  asks api.ipify.org through the tunnel which address your traffic leaves at.
  We receive none of it.
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
- **Location**, only once you list a Wi-Fi network under a VPN's "Wifi
  without VPN". Android tells only apps with location access which Wi-Fi the
  phone is on. ArrowLoop reads the name of that Wi-Fi and the phone's addresses
  on it, hands them to its own engine on the phone and sends them nowhere else.
  It never asks where you are. Access all the time lets timed runs see the
  Wi-Fi while the app is closed.

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
