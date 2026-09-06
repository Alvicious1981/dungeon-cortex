/**
 * lib/actions/travel-command.ts
 *
 * The overland-travel gate, moved out of the action route (DC-AUD-008).
 *
 * Travel is the one resolution gate that emits no `GameEvent` at all: it
 * writes the party's new location, an exhaustion level if the march cost one,
 * and a single system line describing the journey. Nothing it produces reaches
 * the SSE builder, so moving it cannot disturb frame order — the route's most
 * fragile invariant.
 *
 * What it does have is six refusal paths, and those are the reason the
 * function returns `Response | null` rather than `void`: `null` means the
 * journey resolved and the request continues to narration, while a `Response`
 * is a refusal the route must return unchanged. Collapsing that to a thrown
 * error would change status codes.
 *
 * Nothing here was redesigned. The order of the checks, the wording of every
 * refusal, the log line, the transaction boundary and the point at which the
 * player's action becomes canonical are the ones the route had.
 *
 * The route keeps the `intent.actionType === "travel"` dispatch: two
 * architecture guards read that file as text, and
 * `tests/architecture/intent-gate-exhaustiveness.test.ts` would report this
 * classification as ungated if the comparison left it.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { abilityModifier } from "@/lib/rules/dice";
import { travelDistanceMiles, resolveJourney } from "@/lib/rules/travel";

export interface TravelGateInput {
  campaignId: string;
  /** `intent.destination` — absent is a refusal, not a default. */
  destination: string | undefined;
  /** `intent.forceMarch`. Only an explicit `true` forces the march. */
  forceMarch: boolean | undefined;
  /**
   * Whether a fight is still running. Passed as a boolean because the gate
   * only ever asks the question, never reads the encounter.
   */
  hasActiveEncounter: boolean;
  /** Where the party stands now, or `null` if it has no location yet. */
  originLocationId: string | null;
  character: {
    id: string;
    /** Raw JSON — `{ STR, DEX, CON, ... }`. */
    stats: unknown;
    exhaustionLevel: number;
  };
  /**
   * The route's single idempotent writer of the player's own log line. Passed
   * as a callback rather than reimplemented here so the "written at most once"
   * guarantee it shares with every other gate keeps a single owner.
   */
  persistPlayerAction: () => Promise<void>;
}

/**
 * @returns a refusal to return verbatim, or `null` when the journey resolved.
 */
export async function resolveTravelGate({
  campaignId,
  destination: destinationName,
  forceMarch,
  hasActiveEncounter,
  originLocationId,
  character,
  persistPlayerAction,
}: TravelGateInput): Promise<Response | null> {
  if (!destinationName) {
    return NextResponse.json(
      { error: "A destination is required for backend resolution." },
      { status: 400 }
    );
  }

  // Travelling days away would leave a live encounter's initiative order
  // running at a place the party no longer occupies. Refuse rather than
  // hand the narrator a new location and a stale fight on the next turn.
  if (hasActiveEncounter) {
    return NextResponse.json(
      { error: "You cannot march away from a fight that is still happening." },
      { status: 409 }
    );
  }

  const originId = originLocationId;
  if (!originId) {
    return NextResponse.json(
      { error: "You are nowhere to travel from yet." },
      { status: 400 }
    );
  }

  const destination = await prisma.location.findFirst({
    where: {
      campaignId,
      name: { equals: destinationName, mode: "insensitive" },
    },
    select: { id: true, name: true, seed: true },
  });

  if (!destination) {
    const known = await prisma.location.findMany({
      where: { campaignId },
      select: { name: true },
    });
    return NextResponse.json(
      {
        error:
          `You know no place called "${destinationName}". ` +
          `Known: ${known.map((l) => l.name).join(", ") || "nowhere yet"}.`,
      },
      { status: 400 }
    );
  }

  if (destination.id === originId) {
    return NextResponse.json(
      { error: `You are already at ${destination.name}.` },
      { status: 400 }
    );
  }

  const entryNode = await prisma.locationNode.findFirst({
    where: { locationId: destination.id },
    orderBy: { index: "asc" },
    select: { id: true },
  });
  if (!entryNode) {
    return NextResponse.json(
      { error: `${destination.name} has no way in.` },
      { status: 409 }
    );
  }

  const origin = await prisma.location.findUnique({
    where: { id: originId },
    select: { name: true, seed: true },
  });

  // fetchExplorationContext already proved originId's row exists, so this
  // is a data-consistency guard, not an expected path — but if the row
  // vanished between then and now, refuse rather than let a missing seed
  // silently fall back to the id and change the distance on the return leg.
  if (!origin) {
    return NextResponse.json(
      { error: "Your current location could not be resolved." },
      { status: 409 }
    );
  }

  // Every figure is resolved here, before anything is written or narrated.
  const stats = (character.stats ?? {}) as Partial<Record<string, number>>;
  const journey = resolveJourney({
    distanceMiles: travelDistanceMiles(origin.seed, destination.seed),
    forceMarch: forceMarch === true,
    conModifier: abilityModifier(stats.CON ?? 10),
    currentExhaustion: character.exhaustionLevel,
  });

  const dayCount = journey.days === 1 ? "1 day" : `${journey.days} days`;
  const logLine = journey.forcedHours > 0
    ? `Travel: ${origin.name} → ${destination.name}, ` +
      `${journey.distanceMiles} mi forced march, ${journey.hours} h. ` +
      `Forced march: ${journey.forcedHours} h, ` +
      `DC ${journey.saves.map((s) => s.dc).join("/")} → ` +
      `${journey.saves.filter((s) => !s.success).length} failed, ` +
      `exhaustion ${character.exhaustionLevel} → ` +
      `${character.exhaustionLevel + journey.exhaustionGained}.`
    : `Travel: ${origin.name} → ${destination.name}, ` +
      `${journey.distanceMiles} mi at normal pace, ${dayCount}.`;

  // Origin, destination, entry node and journey are all resolved, and the
  // gate has no refusal left. Written before the transaction so the
  // player's line precedes the travel line it writes, and so the
  // transaction's own boundary is unchanged.
  await persistPlayerAction();

  await prisma.$transaction(async (tx) => {
    if (journey.exhaustionGained > 0) {
      await tx.character.update({
        where: { id: character.id },
        data: {
          exhaustionLevel: character.exhaustionLevel + journey.exhaustionGained,
        },
      });
    }

    await tx.campaign.update({
      where: { id: campaignId },
      data: { currentLocationId: destination.id, currentNodeId: entryNode.id },
    });

    await tx.gameLog.create({
      data: { campaignId, role: "system", content: logLine },
    });
  });

  return null;
}
