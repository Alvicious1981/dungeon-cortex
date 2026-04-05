/**
 * lib/memory/formatter.ts
 *
 * Prompt formatting for Milestone D — Memory and continuity.
 *
 * Takes a CampaignContext snapshot and returns a markdown-formatted string
 * suitable for prepending to the AI DM's system instructions. The output
 * gives the model an accurate, up-to-date picture of:
 *   - Character state (HP, spell slots, inventory)
 *   - Active encounter (combatants, initiative order, current turn)
 *   - Recent session events (last few log entries)
 *
 * This module is pure: it performs no I/O and never mutates anything.
 */

import type { CampaignContext } from "@/lib/memory/context";
import { isSpellSlots } from "@/lib/rules/magic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely extracts string[] from the raw JSON conditions field. */
function extractConditions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === "string");
}

/** Maps GameLog role values to human-readable labels for the DM prompt. */
function roleLabel(role: string): string {
  switch (role) {
    case "user":      return "Player";
    case "assistant": return "DM";
    case "system":    return "System";
    default:          return role;
  }
}

/**
 * Truncates a string to `maxLen` characters, appending "…" if cut.
 * Keeps the prompt compact when log entries are long.
 */
function truncate(text: string, maxLen = 200): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 1) + "…";
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

/**
 * Returns the AI DM's immutable persona and operating constraints.
 * These "Iron Laws" are injected first so the model's frame is established
 * before it reads any game-state context.
 *
 * @pure — no parameters, no side effects, constant output.
 */
function formatIronLaws(): string {
  return [
    "## Iron Laws — Referee Persona",
    "You are an impartial, neutral referee simulating a lethal, persistent fantasy world.",
    "You are **NOT** a helpful assistant or a novel writer.",
    "",
    "**Tone:** Dark, serious, visceral, and brief. No embellishment. No comfort.",
    "",
    "**Code is Law / State is Truth:** You have **no mechanical authority**.",
    "Only narrate the exact mathematical and state changes provided in the context below.",
    "Never invent miraculous saves, never fudge dice, and never protect the players",
    "from the consequences of the rules. If the rules kill the character, the character dies.",
  ].join("\n");
}

function formatCharacter(character: CampaignContext["character"]): string {
  const lines: string[] = [];

  lines.push("## Character State");
  lines.push(
    `**${character.name}** — ${character.race} ${character.class}, Level ${character.level}`
  );
  lines.push(`**HP:** ${character.hp} / ${character.maxHp}`);

  // Spell slots — only shown for characters with spellcasting ability
  const slots = character.spellSlots;
  if (isSpellSlots(slots)) {
    const slotSummary = Object.entries(slots)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([level, entry]) => `L${level}: ${entry?.current ?? 0}/${entry?.max ?? 0}`)
      .join("  |  ");
    lines.push(`**Spell Slots:** ${slotSummary}`);
  }

  // Inventory
  if (character.inventory.length === 0) {
    lines.push("**Inventory:** (empty)");
  } else {
    lines.push("**Inventory:**");
    for (const item of character.inventory) {
      const qty = item.quantity > 1 ? ` ×${item.quantity}` : "";
      lines.push(`- ${item.name}${qty} *(${item.type})*`);
    }
  }

  return lines.join("\n");
}

function formatEncounter(encounter: CampaignContext["activeEncounter"]): string {
  if (!encounter) {
    return "## Combat\nNo active encounter.";
  }

  const lines: string[] = [];
  lines.push("## Combat");
  lines.push(`**Round:** ${encounter.round}`);

  lines.push("**Initiative Order:**");
  encounter.combatants.forEach((combatant, index) => {
    const isCurrent = index === encounter.currentTurnIndex;
    const turnMarker = isCurrent ? " ◀ CURRENT TURN" : "";
    const conditions = extractConditions(combatant.conditions);
    const conditionText = conditions.length > 0 ? ` [${conditions.join(", ")}]` : "";
    const tag = combatant.isPlayer ? "(Player)" : "(Enemy)";
    lines.push(
      `${index + 1}. **${combatant.name}** ${tag} — HP: ${combatant.hp}/${combatant.maxHp}, Initiative: ${combatant.initiativeTotal}${conditionText}${turnMarker}`
    );
  });

  return lines.join("\n");
}

function formatRecentLogs(logs: CampaignContext["recentLogs"]): string {
  if (logs.length === 0) {
    return "## Recent Events\n*(No events recorded yet.)*";
  }

  const lines: string[] = [];
  lines.push("## Recent Events");
  for (const log of logs) {
    lines.push(`**${roleLabel(log.role)}:** ${truncate(log.content)}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Returns a markdown-formatted system prompt section derived from the
 * current campaign context. Append this to the AI DM's system instructions
 * so the model always has accurate game state without hallucinating it.
 *
 * @pure — no side effects, deterministic output for the same input.
 */
export function formatSystemPrompt(context: CampaignContext): string {
  const sections = [
    formatIronLaws(),
    "# Current Game State",
    formatCharacter(context.character),
    formatEncounter(context.activeEncounter),
    formatRecentLogs(context.recentLogs),
  ];

  return sections.join("\n\n");
}
