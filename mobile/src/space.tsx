import { useEffect, useState } from "react";
import { failureLine, type Failure } from "../../web/src/lib/failure";
import { isLocalTarget } from "../../web/src/lib/localTarget";
import { checkWord } from "../../web/src/lib/targetCheck";
import { api, type Remote, type Usage } from "./api";
import { useT } from "./i18n";
import { Badge, Caption, Meter, Press, Tip } from "./ui";
import { usageShown } from "./usage";

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

/** What a target's check answered, with the reason when it failed. */
export interface Reach {
  ok: boolean;
  /** A target a job reaches through its VPN, left unchecked while that VPN is off. */
  unchecked?: boolean;
  reason?: string;
  failure?: Failure;
}

/**
 * Asks the engine to check every target, in parallel, and keeps each answer,
 * absent while it is being asked. A target's size says nothing about this,
 * since many backends report none without connecting.
 */
export function useReach(remotes: Remote[] | null): Record<string, Reach> {
  const [reach, setReach] = useState<Record<string, Reach>>({});
  const names = (remotes ?? []).map((r) => r.name).join("\n");

  useEffect(() => {
    if (!remotes) return;
    let live = true;
    const answer = (name: string, said: Reach) => live && setReach((old) => ({ ...old, [name]: said }));
    for (const remote of remotes) {
      api.checkRemote(remote.name).then(
        (result) => answer(remote.name, result),
        (e: Error) => answer(remote.name, { ok: false, reason: e.message }),
      );
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names]);

  return reach;
}

/**
 * Connected or Not connected, once the check has answered, or that the target
 * goes through a VPN that is off. Not connected opens the reason on a tap,
 * since a badge has no room for it.
 */
export function ReachBadge({ reach }: { reach: Reach | undefined }) {
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);
  if (reach === undefined) return null;
  if (reach.ok) return <Badge label={t("targets.checkOk")} tone="ok" />;
  if (reach.unchecked) return <Badge label={t(checkWord(reach))} />;
  const label = t("targets.checkFailed");
  if (!reach.reason) return <Badge label={label} tone="fail" />;
  const reason = failureLine(reach.reason, reach.failure, t, lang);
  return (
    <>
      <Press onPress={() => setOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${label}: ${reason}`}>
        <Badge label={label} tone="fail" />
      </Press>
      <Tip open={open} text={reason} onClose={() => setOpen(false)} />
    </>
  );
}

/** The usage bar and its caption, or nothing when the target gave no figure. */
export function Room({ room, hue }: { room: Room; hue?: string }) {
  const { t } = useT();
  // An unreachable target already shows a badge on its card.
  if (!room || unreachable(room) || room === "gone") return null;
  const shown = usageShown(room, t);
  if (!shown) return null;
  return (
    <>
      {shown.meter ? <Meter done={shown.meter.done} total={shown.meter.total} hue={hue} slosh /> : null}
      <Caption>{shown.line}</Caption>
    </>
  );
}
