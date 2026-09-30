import type { PartyRole, PartyControlMode } from "@prisma/client";

/**
 * Hard cap per DC-PARTY-001: 1 MAIN + up to 2 COMPANION rows per campaign.
 * Application-layer, not a DB CHECK/trigger — see docs/PARTY_AND_COMPANIONS.md.
 */
export const MAX_ACTIVE_PARTY_MEMBERS = 3;

export type PartyCapacityRefusal = {
  code: "PARTY_AT_CAPACITY";
  error: string;
};

export function partyCapacityRefusal(
  campaignId: string,
  currentActiveCount: number
): PartyCapacityRefusal | null {
  if (currentActiveCount >= MAX_ACTIVE_PARTY_MEMBERS) {
    return {
      code: "PARTY_AT_CAPACITY",
      error: `Campaign ${campaignId} already has ${currentActiveCount} active party members (max ${MAX_ACTIVE_PARTY_MEMBERS}).`,
    };
  }
  return null;
}

/**
 * The one shape every MAIN row must have. The campaign-creation route and
 * every test that needs a MAIN row build it through this function, so what
 * "main" means changes in exactly one place.
 */
export function buildMainPartyMemberData(
  campaignId: string,
  characterId: string
): { campaignId: string; characterId: string; role: PartyRole; control: PartyControlMode } {
  return { campaignId, characterId, role: "MAIN", control: "USER" };
}
