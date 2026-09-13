import { useEffect, useState } from "react";
import { api, type Remote, type Usage } from "./api";
import { useT } from "./i18n";
import { Caption, Meter } from "./ui";

/**
 * How full a target is, asked and drawn.
 *
 * Its own module because TWO screens ask the same question now - the overview
 * and the targets list - and jdp asked for the second one in the same breath as
 * the first: "die verbundenen konten sollen den speicherplatz anzeigen auf der
 * card wie in autosync." Two copies of "fetch about, work out used from free,
 * pick the sentence that fits what the service actually reported" would be two
 * places to get the arithmetic wrong.
 */

/** Bytes as somebody would say them. */
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
 * What one target says about its own size, or that it said nothing.
 *
 * `"gone"` is the target that could not be reached at all, which is a different
 * answer from a target that answered and does not count - and the card says
 * which, because "no bar" for both would read as one fault.
 */
export type Room = Usage | "gone" | undefined;

/**
 * Whether a reading means the target could not be reached.
 *
 * TWO WAYS to arrive at the same picture, and they used to be told apart by
 * only one of them. A request that FAILED gives `"gone"`. But the engine
 * answers an unreachable target with `200` and `{supported:false, reason:…}`,
 * because a target that cannot be reached is an answer rather than a broken
 * request - so the promise resolves, the card called it "reached, keeps no
 * total", and jdp's OpenCloud sat under a sentence saying it does not report
 * its size when the truth was that his phone cannot route to it.
 */
export function unreachable(room: Room): boolean {
  if (room === undefined) return false;
  if (room === "gone") return true;
  return !!room.reason;
}

/**
 * Asks every target how full it is, each on its own.
 *
 * ONE REQUEST PER TARGET because that is what the engine offers: `about` is a
 * live question put to the service. They are fired together and land as they
 * land, so a cloud that takes four seconds does not hold up the three that
 * answered at once.
 */
export function useRoom(remotes: Remote[] | null): Record<string, Room> {
  const [room, setRoom] = useState<Record<string, Room>>({});

  // Keyed on the NAMES rather than the array, so a fresh fetch of the same
  // targets - which every focus of the targets screen produces - does not ask
  // every cloud again.
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
 * The bar and the sentence under it.
 *
 * Every line is drawn from what the service ACTUALLY reported rather than from
 * a total that was assumed and then divided by: a bucket has no size at all, a
 * disk has all three numbers, and plenty of things in between report one.
 *
 * Three silences, and only two of them are silent here. Nothing while the
 * answer is on its way; nothing for a target that could not be reached, because
 * its card says that in a badge and saying it twice would read as two faults.
 * But a target that ANSWERED and does not count says so in words - seen on the
 * device, where an S3 bucket sat under its own name with nothing at all beneath
 * it, which reads as a card that failed to finish loading.
 */
export function Room({ room, hue }: { room: Room; hue?: string }) {
  const { t } = useT();
  // Nothing while the answer is on its way, and nothing for a target that could
  // not be reached - its card says that in a badge, and saying it twice would
  // read as two faults.
  if (!room || unreachable(room) || room === "gone") return null;
  if (!room.supported) return <Caption>{t("overview.noSpace")}</Caption>;

  const total = room.total ?? 0;
  const free = room.free;
  // `used` is what the service says is gone, or what is left over from the
  // total once the free part is taken off. Zero is a real answer here and not
  // a missing one, which is why this is `??` and not `||`.
  const used = room.used ?? (total > 0 && free !== undefined ? total - free : undefined);

  // WHETHER THE SERVICE SAID ANYTHING AT ALL, asked before what it said.
  //
  // A WebDAV cloud reports the bytes in use and no total, and an empty one
  // reports zero - which the old shape could not tell from silence, so
  // OpenCloud with nothing in it claimed to keep no figures. The three
  // sentences below then pick themselves from what is actually there.
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
