# ArrowLoop

Two-way file sync that shows you the plan before it moves anything.

ArrowLoop keeps two folders in step, say a NAS share and a laptop, or a phone and a WebDAV cloud. It remembers what both sides last agreed on, lists every change with its direction and reason before a run, and stops when a run would delete more than it should. Deleted files go to a trash. Either side can be a local folder, SMB, SFTP, S3-compatible storage, WebDAV or anything else rclone speaks.

The image serves the web interface on port 8422 and is built for `linux/amd64` and `linux/arm64`.

## Quick start

```sh
docker run -d --name arrowloop -p 8422:8422 \
  -v /path/to/config:/config \
  -v /path/to/data:/data \
  junkerderprovinz/arrowloop:latest
```

With Compose:

```yaml
services:
  arrowloop:
    image: junkerderprovinz/arrowloop:latest
    container_name: arrowloop
    restart: unless-stopped
    hostname: arrowloop
    ports:
      - "8422:8422"
    volumes:
      - "./appdata:/config"
      - "./data:/data"
    environment:
      TZ: Europe/Berlin
      ARROWLOOP_ADDR: "0.0.0.0:8422"
      ARROWLOOP_UMASK: "000"
```

Then open port 8422 in a browser and add your first job. Until you set a password under Settings, Security, anyone who can reach that port can start a sync that deletes files, so keep it on your LAN.

| Path | Holds |
| --- | --- |
| `/config` | `arrowloop.json`, one state database per job and the run log. Keep it across updates: without the state databases every job forgets what the two sides agreed on. |
| `/data` | The folders you want to sync. Mount it read-write. |

| Variable | Default | Use |
| --- | --- | --- |
| `TZ` | `Europe/Berlin` | The time zone your schedules run in. |
| `ARROWLOOP_UMASK` | `000` | The container runs as root. `000` leaves copied files writable for the share's owner, `022` makes them read-only for everyone but root. |
| `ARROWLOOP_ADDR` | `0.0.0.0:8422` | Where the interface listens inside the container. |
| `ARROWLOOP_PASSWORD_HASH` | empty | Optional. Overrides the password set in the interface, and is the way back in after a forgotten one. |

## Tags

| Tag | Image |
| --- | --- |
| `latest` | The newest release. |
| `2.7.6` and so on | One release, by version number. |
| `edge` | The tip of the main branch, built on every push. Not a release. |
| `sha-<commit>` | One build, by the first seven characters of its commit. |

## Links

- [Documentation](https://junkerderprovinz.github.io/arrowloop/)
- [Installing](https://junkerderprovinz.github.io/arrowloop/installing/), with passwords, reverse proxies and updates
- [Source on GitHub](https://github.com/junkerderprovinz/arrowloop)
- [Issues](https://github.com/junkerderprovinz/arrowloop/issues)
- [Unraid template](https://ca.unraid.net/apps/arrowloop-04rvnbl1yv3wn1)
- License: [AGPL-3.0](https://github.com/junkerderprovinz/arrowloop/blob/main/LICENSE)
