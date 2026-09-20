/**
 * lib/rules/social-log.ts
 *
 * Shared deterministic social GameLog formatter.
 *
 * Both `/api/campaign/[id]/social` (DialogueOverlay modal) and
 * `/api/campaign/[id]/action` (natural-language chat) resolve social checks
 * through `resolveSocialCheck` and must produce byte-identical GameLog history.
 */

import type { SocialApproach } from "@/lib/rules/social-service";

export interface FormatSocialCheckLogInput {
  npcName: string;
  approach: SocialApproach | string;
  intent?: string;
  result: {
    skill: string;
    roll: number;
    abilityModifier: number;
    proficiencyApplied: number;
    total: number;
    dc: number;
    success: boolean;
    attitudeBefore: string;
    attitudeAfter: string;
    dispositionBefore: number;
    dispositionAfter: number;
  };
}

export function formatSocialCheckLog(input: FormatSocialCheckLogInput): string {
  const { npcName, approach, intent, result } = input;
  const trimmedIntent = intent?.trim();
  const intentClause = trimmedIntent ? ` with intent "${trimmedIntent}"` : "";
  const modSign = result.abilityModifier >= 0 ? "+" : "";
  const profClause = result.proficiencyApplied ? ` +${result.proficiencyApplied} prof` : "";
  const outcome = result.success ? "SUCCESS" : "FAILURE";

  return (
    `🎲 Social check: ${result.skill} (${approach}) targeting ${npcName}${intentClause}: ` +
    `rolled ${result.roll}${modSign}${result.abilityModifier}${profClause} = ${result.total} vs DC ${result.dc} → ${outcome}. ` +
    `Attitude: ${result.attitudeBefore} → ${result.attitudeAfter} ` +
    `(disposition: ${result.dispositionBefore} → ${result.dispositionAfter}).`
  );
}
