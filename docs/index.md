# ArrowLoop

Two-way file synchronisation that shows you the plan before it moves anything.

Every other sync tool's main screen is a progress bar, which is a report on a
decision somebody already made for you. Here you get the decision: every
proposed change listed with its direction and the reason for it, each row
unticked if you disagree, and nothing touched until you press the button.

It is a self-hosted replacement for [GoodSync](https://www.goodsync.com). The
engine is the part that can lose data, and it is proved on its own; the
scheduler, the job file and the run log are built on top of it.
[How it compares](comparison.md) sets it beside GoodSync and the other tools.

## The name

The name is a picture of how it works: two arrows closing a loop. What happens
on one side arrives on the other and comes back, and between the two ends sits
the record of what they last agreed on. That makes three pieces: the two ends,
the state database, and the refusal to apply a reckoning that does not add up.
The third is the one that matters when something goes wrong.

## What makes it different

It keeps a **per-file record of what both sides looked like the last time they
agreed**. Without that third term, "the file is here but not there" is
ambiguous: it means either "created over here" or "deleted over there", and
those two call for opposite actions. Every two-way sync that loses data loses it
there.

It **refuses** rather than guesses. A deletion goes to a trash instead of away.
A run that would delete an implausible share of your files stops and says so. A
side that lists nothing at all is never believed, because a disk that failed to
mount looks exactly like a folder somebody emptied.

It reaches **local folders, network shares, SFTP, S3-compatible storage, WebDAV
clouds such as Nextcloud and OpenCloud, and the other services rclone speaks**,
and to the engine they are all the same thing. [rclone](https://rclone.org) is
compiled in as a library rather than shelled out to, with every backend it
ships, so there is no second executable to keep in step. Services that only
sign in through a browser take a token made once with `rclone authorize`; see
[Configuring a job](configuration.md#services-that-sign-in-through-a-browser).

## Where to go next

- [Installing](installing.md) as a container, a desktop app, an Android app, or
  a single binary.
- [Configuring a job](configuration.md), every setting and what it is for.
- [The interface](interface.md), the preview and the tabs around it.
- [Command line](cli.md) for a machine nobody is looking at.
- [How it decides](decisions.md), the table the whole engine rests on.
- [Safety](safety.md), what stops it destroying anything.
- [How it compares](comparison.md) with GoodSync, Syncthing and the rest.
- [How it is tested](testing.md).
- [When something goes wrong](troubleshooting.md).

!!! warning "Without a password, anyone who reaches the interface can drive it"
    It asks for a password once one is set under Settings, Security, or through
    `ARROWLOOP_PASSWORD_HASH`. Until then keep it on your own network, or put it
    behind something that asks who the visitor is. It can start a job that
    deletes files.
