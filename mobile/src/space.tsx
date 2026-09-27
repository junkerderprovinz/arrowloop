import { useEffect, useState } from "react";
import { isLocalTarget } from "../../web/src/lib/localTarget";
import { api, type Remote, type Usage } from "./api";
import { useT } from "./i18n";
import { Badge, Caption, Meter } from "./ui";

// How full a target is, fetched and drawn for both the overview and the
// targets list.

/**
 * Reports whether a target is storage elsewhere rather than the phone itself,
 * which the target lists leave out.
 */
export function isAccount(remote: Remote): boolean {
  return !isLocalTarget(remote);
}

/**
 * Returns who a target signs in as and where it points, read from its own
 * settings. Secrets are never shown, and neither is `access_key_id`: rclone
 * does not mark it secret, but it is half a credential.
 */
export function account(remote: Remote): { who?: string; where?: string } {
  const said = (key: string) => remote.settings.find((s) => s.key === key && !s.secret)?.value;
  return { who: said("user"), where: said("url") ?? said("endpoint") ?? said("remote") };
}

export function bytes(n: number | undefined): string {
  if (n === undefined) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * A target's reported size, "gone" when the request failed, or undefined while
 * it is pending.
 */
export type Room = Usage | "gone" | undefined;

/**
 * Reports whether a reading means the target could not be reached: either
 * the request failed, or the engine answered with a reason.
 */
export function unreachable(room: Room): boolean {
  if (room === undefined) return false;
  if (room === "gone") return true;
  return !!room.reason;
}

/**
 * Asks every target how full it is, in parallel, and fills each answer in as
 * it lands.
 */
export function useRoom(remotes: Remote[] | null): Record<string, Room> {
  const [room, setRoom] = useState<Record<string, Room>>({});

  // Keyed on the names, so refetching the same targets does not ask again.
  const names = (remotes ?? []).map((r) => r.name).join("\n");

  useEffect(() => {
    if (!remotes) return;
    let live = true;
    for (const remote of remotes) {
      api.aboutRemote(remote.name).then(
        (usage) => live && setRoom((old) => ({ ...old, [remote.name]: usage })),
        () => live && setRoom((old) => ({ ...old, [remote.name]: "gone" })),
      );
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names]);

  return room;
}

/**
 * Asks the engine to check every target, in parallel: true once one answers,
 * false once it fails, absent while it is being asked. A target's size says
 * nothing about this, since many backends report none without connecting.
 */
export function useReach(remotes: Remote[] | null): Record<string, boolean> {
  const [reach, setReach] = useState<Record<string, boolean>>({});
  const names = (remotes ?? []).map((r) => r.name).join("\n");

  useEffect(() => {
    if (!remotes) return;
    let live = true;
    const answer = (name: string, ok: boolean) => live && setReach((old) => ({ ...old, [name]: ok }));
    for (const remote of remotes) {
      api.checkRemote(remote.name).then(
        (result) => answer(remote.name, result.ok),
        () => answer(remote.name, false),
      );
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names]);

  return reach;
}

/** Connected or Not connected, once the check has answered. */
export function ReachBadge({ reach }: { reach: boolean | undefined }) {
  const { t } = useT();
  if (reach === undefined) return null;
  return <Badge label={t(reach ? "targets.checkOk" : "targets.checkFailed")} tone={reach ? "ok" : "fail"} />;
}

/**
 * The usage bar and its caption, drawn from whichever numbers the service
 * reported: a bucket has none, a disk has all three.
 */
export function Room({ room, hue }: { room: Room; hue?: string }) {
  const { t } = useT();
  // An unreachable target already shows a badge on its card.
  if (!room || unreachable(room) || room === "gone") return null;
  if (!room.supported) return <Caption>{t("overview.noSpace")}</Caption>;

  const total = room.total ?? 0;
  const free = room.free;
  // Zero used is a real answer, hence `??`.
  const used = room.used ?? (total > 0 && free !== undefined ? total - free : undefined);

  // WebDAV reports bytes in use without a total, and zero when empty.
  if (total <= 0 && used === undefined) return <Caption>{t("overview.noSpace")}</Caption>;

  return (
    <>
      {total > 0 ? <Meter done={used ?? 0} total={total} hue={hue} /> : null}
      <Caption>
        {total > 0 && free !== undefined
          ? t("targets.spaceFree", { free: bytes(free), total: bytes(total) })
          : used !== undefined
            ? t("targets.spaceUsed", { used: bytes(used) })
            : t("targets.spaceTotal", { total: bytes(total) })}
      </Caption>
    </>
  );
}
