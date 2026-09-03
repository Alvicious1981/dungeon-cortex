/**
 * lib/rules/travel.ts
 *
 * SRD 2014 overland travel. Pure: no I/O, no Prisma, deterministic for the
 * same inputs.
 *
 * The canonical decision this implements — SRD travel, explicitly not a
 * hexcrawl — is recorded in
 * docs/superpowers/specs/2026-09-03-wilderness-travel-srd-design.md.
 */
import { seededFloat } from "@/lib/rules/generators";
import { resolveSavingThrow } from "@/lib/rules/combat";

/** SRD normal travel pace: 3 miles per hour. */
export const MILES_PER_HOUR_NORMAL = 3;

/** SRD travel day: eight hours of marching. Beyond this the march is forced. */
export const TRAVEL_HOURS_PER_DAY = 8;

/** 24 miles — what eight hours at the normal pace covers. */
export const MILES_PER_DAY_NORMAL = MILES_PER_HOUR_NORMAL * TRAVEL_HOURS_PER_DAY;

/** Journey distance bounds, inclusive. */
export const MIN_JOURNEY_MILES = 12;
export const MAX_JOURNEY_MILES = 48;

/** SRD exhaustion runs 1..6. Level 6 is death, which this game does not model. */
export const MAX_EXHAUSTION = 6;

export interface ForcedMarchSave {
  /** Absolute hour of the march: the first forced hour is the ninth. */
  hour: number;
  dc: number;
  roll: number;
  total: number;
  success: boolean;
}

export interface JourneyOutcome {
  distanceMiles: number;
  days: number;
  /**
   * Hours marched on the heaviest day. For normal travel this is the SRD
   * eight-hour day; the final day may be shorter, which is not tracked because
   * nothing consumes it.
   */
  hours: number;
  forcedHours: number;
  saves: ForcedMarchSave[];
  exhaustionGained: number;
}

/**
 * Distance between two locations, derived from their seeds.
 *
 * `Location` has neither coordinates nor a distance column, and this adds
 * none: deriving from a seed is the convention the repository already uses for
 * location names and loot flavour.
 */
export function travelDistanceMiles(seedA: string, seedB: string): number {
  // Sorted before seeding: a journey has no direction, so the return leg must
  // measure the same as the outbound one.
  const [first, second] = [seedA, seedB].sort();
  const span = MAX_JOURNEY_MILES - MIN_JOURNEY_MILES + 1;
  return (
    MIN_JOURNEY_MILES +
    Math.floor(seededFloat(`${first}->${second}:distance`) * span)
  );
}

/**
 * Resolves a journey.
 *
 * Normal travel costs days and nothing else — camping between them is assumed
 * and needs no state. A forced march covers the whole distance in one day, and
 * every hour past the eighth is an SRD Constitution save at DC 10 + 1 per hour
 * past eight; each failure is one level of exhaustion.
 *
 * Never throws.
 */
export function resolveJourney(input: {
  distanceMiles: number;
  forceMarch: boolean;
  conModifier: number;
  currentExhaustion: number;
}): JourneyOutcome {
  const { distanceMiles, forceMarch, conModifier, currentExhaustion } = input;

  if (!forceMarch) {
    return {
      distanceMiles,
      days: Math.ceil(distanceMiles / MILES_PER_DAY_NORMAL),
      hours: TRAVEL_HOURS_PER_DAY,
      forcedHours: 0,
      saves: [],
      exhaustionGained: 0,
    };
  }

  const hours = Math.ceil(distanceMiles / MILES_PER_HOUR_NORMAL);
  const forcedHours = Math.max(0, hours - TRAVEL_HOURS_PER_DAY);
  const saves: ForcedMarchSave[] = [];
  let failed = 0;

  for (let past = 1; past <= forcedHours; past++) {
    const dc = 10 + past;
    // Delegated, not reimplemented: SRD saving throws already have exactly one
    // implementation and this does not become a second.
    const { success, roll, total } = resolveSavingThrow(conModifier, dc);
    saves.push({ hour: TRAVEL_HOURS_PER_DAY + past, dc, roll, total, success });
    if (!success) failed += 1;
  }

  const headroom = Math.max(0, MAX_EXHAUSTION - currentExhaustion);

  return {
    distanceMiles,
    days: 1,
    hours,
    forcedHours,
    saves,
    exhaustionGained: Math.min(failed, headroom),
  };
}
