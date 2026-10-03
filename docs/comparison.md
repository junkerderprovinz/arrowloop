# How it compares

[GoodSync](https://www.goodsync.com) is the tool ArrowLoop was built to
replace. [FreeFileSync](https://freefilesync.org),
[Syncovery](https://www.syncovery.com) and
[SyncBack](https://www.2brightsparks.com/syncback/) work the same way, a job you
run or schedule, and are desktop programs first.
[Syncthing](https://syncthing.net) and
[Resilio Sync](https://www.resilio.com/sync/) keep folders identical between
devices in real time, with nothing to review before it happens.
[Unison](https://github.com/bcpierce00/unison) and
[rclone bisync](https://rclone.org/bisync/) are two-way sync for the command
line. ArrowLoop takes GoodSync's way of working and rclone's reach, runs as a
container or a desktop app, and keeps a record of what both sides last agreed
on.

| | **ArrowLoop** | GoodSync | FreeFileSync | Syncthing | Resilio | bisync | Unison | Syncovery | SyncBack |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Every change shown before the run, single ones can be dropped | ✅ | ✅ | ✅ | ❌ | ❓ | ❌ | ✅ | ✅ | ✅ |
| Brake on a run that deletes too much | ✅ | ⚠️ | ⚠️ | ❌ | ❓ | ✅ | ⚠️ | ✅ | ⚠️ |
| An empty or unmounted side is refused | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ⚠️ |
| Deletions go to a trash by default | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ |
| An edit on both sides keeps both versions by itself | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ | ✅ | ⚠️ | ⚠️ | ❌ |
| Cloud and server targets without a mount | ✅ | ✅ | ⚠️ | ❌ | ❌ | ✅ | ⚠️ | ✅ | ✅ |
| Encryption at the destination | ✅ | ⚠️ | ❌ | ⚠️ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Sends only the changed part of a file | ❌ | ⚠️ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ⚠️ |
| Copies files another program holds open | ⚠️ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Built-in schedule | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ⚠️ | ✅ | ⚠️ |
| Real-time watching | ✅ | ✅ | ⚠️ | ✅ | ✅ | ❌ | ✅ | ⚠️ | ✅ |
| Scripts before and after a run | ✅ | ✅ | ⚠️ | ❌ | ❓ | ❌ | ❌ | ✅ | ✅ |
| Notification when a run fails | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ✅ | ✅ |
| Device to device over the internet, no port forwarding | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Official container image | ✅ | ❌ | ❌ | ✅ | ⚠️ | ✅ | ❌ | ❌ | ❌ |
| Web interface | ✅ | ⚠️ | ❌ | ✅ | ⚠️ | ❌ | ❌ | ⚠️ | ❌ |
| Desktop app | ✅ | ✅ | ✅ | ⚠️ | ✅ | ❌ | ✅ | ✅ | ✅ |
| Windows, macOS and Linux | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Android | ✅ | ✅ | ❌ | ⚠️ | ✅ | ⚠️ | ❌ | ❌ | ⚠️ |
| iOS | ❌ | ✅ | ❌ | ⚠️ | ✅ | ❌ | ❌ | ❌ | ❌ |
| No account and no vendor relay | ✅ | ❌ | ✅ | ⚠️ | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| Open source | ✅ | ❌ | ⚠️ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Free, with every feature | ✅ | ❌ | ⚠️ | ✅ | ⚠️ | ✅ | ✅ | ❌ | ⚠️ |
| Past 1.0 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

✅ yes · ⚠️ with a catch: off by default, a paid edition, one platform only or a
community build · ❌ no · ❓ undocumented.

Checked against each project's own documentation in September 2026.

ArrowLoop has no relay of its own. To sync between two places over the
internet, put both machines in one private network, as
[Installing](installing.md#syncing-between-two-places-over-the-internet)
describes.
