# ArrowLoop

Two-way file synchronisation that shows you the plan before it moves anything.

Every other sync tool's main screen is a progress bar, which is a report on a
decision somebody already made for you. Here you get the decision: every
proposed change listed with its direction and the reason for it, each row
unticked if you disagree, and nothing touched until you press the button.

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

It reaches **local folders, network shares, SFTP and S3-compatible storage**,
with [rclone](https://rclone.org) compiled in as a library rather than shelled
out to. There is no second executable to keep in step.

## Where to go next

- [Installing](installing.md) as a container, a desktop app, or a single binary.
- [Configuring a job](configuration.md), every setting and what it is for.
- [How it decides](decisions.md), the table the whole engine rests on.
- [Safety](safety.md), what stops it destroying anything.
- [Command line](cli.md) for a machine nobody is looking at.
- [When something goes wrong](troubleshooting.md).

!!! warning "The interface has no login of its own"
    Keep it on your own network, or put it behind something that asks who the
    visitor is. It can start a job that deletes files.
